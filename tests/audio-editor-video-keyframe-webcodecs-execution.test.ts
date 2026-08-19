/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import {
	createVideoKeyframeExportFrameSource,
	type VideoKeyframeExportFrame,
	type VideoKeyframeExportFrameSource,
} from '../src/common/editor/video-keyframe-export-frame-source.ts';
import {
	encodeVideoKeyframeFrames,
	type VideoKeyframeRgbaFrameProducer,
} from '../src/common/editor/video-keyframe-encoder-stream.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_MODEL_PROFILE;

test('a WebCodecs delivery stream-copies into the same container the FFmpeg tier writes', async () => {
	const frameSource = source({ width: 4, height: 4, frameRate: 3 });
	const ffmpeg = fakeFfmpeg();
	const encoder = recordingEncoder();
	const result = await encodeVideoKeyframeFrames({
		frameSource,
		producer: producerFor(frameSource),
		ffmpeg: ffmpeg as never,
		format: 'mp4',
		quality: 'high',
		inputPath: '/frames.h264',
		outputPath: '/encoded.mp4',
		ringCapacityBytes: 4_096,
		webCodecs: decision(encoder),
	});
	assert.equal(result.videoEncoder, 'webcodecs');
	assert.equal(result.codec, 'avc1.4d001e');
	assert.equal(result.frameCount, 3);
	// H.264 is written verbatim, so the ring carries exactly the encoder's chunks.
	assert.equal(result.videoByteLength, 3 * 8);
	assert.deepEqual(ffmpeg.arguments, [
		'-nostdin', '-y', '-f', 'h264', '-r', '3/1', '-i', '/frames.h264',
		'-frames:v', '3', '-map', '0:v:0', '-map_metadata', '-1',
		'-map_chapters', '-1', '-sn', '-dn', '-c:v', 'copy', '-an',
		'-movflags', '+faststart', '-f', 'mp4', '/encoded.mp4',
	]);
	assert.equal(encoder.configured?.codec, 'avc1.4d001e');
	assert.deepEqual(encoder.configured?.avc, { format: 'annexb' });
	// The exact rational, in microseconds, never a decimal frames-per-second.
	assert.deepEqual(encoder.timestamps, [0, 333_333, 666_667]);
	assert.deepEqual(encoder.keyFrames, [true, false, false]);
});

test('a WebM WebCodecs delivery frames its chunks as IVF and copies them', async () => {
	const frameSource = source({ width: 4, height: 4, frameRate: 3 });
	const ffmpeg = fakeFfmpeg();
	const encoder = recordingEncoder();
	const result = await encodeVideoKeyframeFrames({
		frameSource,
		producer: producerFor(frameSource),
		ffmpeg: ffmpeg as never,
		format: 'webm',
		inputPath: '/frames.ivf',
		outputPath: '/encoded.webm',
		ringCapacityBytes: 4_096,
		webCodecs: decision(encoder, 'vp09.00.10.08'),
	});
	assert.equal(result.videoEncoder, 'webcodecs');
	// A 32-byte DKIF header plus a 12-byte header on each of three frames.
	assert.equal(result.videoByteLength, 32 + 3 * (12 + 8));
	const written = concatenate(ffmpeg.writes);
	assert.equal(new TextDecoder().decode(written.subarray(0, 4)), 'DKIF');
	assert.equal(new TextDecoder().decode(written.subarray(8, 12)), 'VP90');
	assert.deepEqual(ffmpeg.arguments.slice(0, 8), [
		'-nostdin', '-y', '-f', 'ivf', '-r', '3/1', '-i', '/frames.ivf',
	]);
	assert.ok(ffmpeg.arguments.includes('copy'));
	assert.equal(ffmpeg.arguments.includes('libvpx-vp9'), false);
});

test('a WebCodecs delivery encodes the same audio at the same tier as the FFmpeg one', async () => {
	const frameSource = source({ width: 4, height: 4, frameRate: 3 });
	const tiers = await Promise.all(['ffmpeg', 'webcodecs'].map(async (tier) => {
		const ffmpeg = fakeFfmpeg();
		await encodeVideoKeyframeFrames({
			frameSource,
			producer: producerFor(frameSource),
			ffmpeg: ffmpeg as never,
			format: 'mp4',
			quality: 'high',
			inputPath: tier === 'webcodecs' ? '/frames.h264' : '/frames.rgba',
			outputPath: '/encoded.mp4',
			ringCapacityBytes: 4_096,
			...(tier === 'webcodecs' ? { webCodecs: decision(recordingEncoder()) } : {}),
		});
		return ffmpeg.arguments;
	}));
	const [ffmpegTier, webCodecsTier] = tiers;
	for (const shared of ['-map_metadata', '-1', '-map_chapters', '-sn', '-dn', '-movflags', '+faststart']) {
		assert.ok(ffmpegTier!.includes(shared) && webCodecsTier!.includes(shared), shared);
	}
	// The picture differs; nothing else may.
	assert.deepEqual(
		ffmpegTier!.slice(ffmpegTier!.indexOf('-c:v')).filter((value) => value.startsWith('-c:a')),
		webCodecsTier!.slice(webCodecsTier!.indexOf('-c:v')).filter((value) => value.startsWith('-c:a')),
	);
});

test('a refused encoder configuration fails the delivery instead of truncating it', async () => {
	const frameSource = source({ width: 4, height: 4, frameRate: 3 });
	const ffmpeg = fakeFfmpeg();
	const encoder = recordingEncoder({ failOnFrame: 1 });
	await assert.rejects(encodeVideoKeyframeFrames({
		frameSource,
		producer: producerFor(frameSource),
		ffmpeg: ffmpeg as never,
		format: 'mp4',
		inputPath: '/frames.h264',
		outputPath: '/encoded.mp4',
		ringCapacityBytes: 4_096,
		webCodecs: decision(encoder),
	}), /encoder gave up/u);
	assert.ok(ffmpeg.events.includes('terminate-execution'));
	assert.equal(encoder.closed, true);
});

test('the WebCodecs decision is admitted as strictly as every other request field', async () => {
	const frameSource = source({ width: 4, height: 4, frameRate: 3 });
	const base = {
		frameSource,
		producer: producerFor(frameSource),
		ffmpeg: fakeFfmpeg() as never,
		format: 'mp4' as const,
		inputPath: '/frames.h264',
		outputPath: '/encoded.mp4',
		ringCapacityBytes: 4_096,
	};
	const valid = decision(recordingEncoder());
	for (const [webCodecs, message] of [
		[{ ...valid, codec: '' }, /codec must be a codec string/u],
		[{ ...valid, bitrate: 0 }, /bitrate must be a positive integer/u],
		[{ ...valid, encoderClass: {} }, /encoderClass must be a constructor/u],
		[{ ...valid, videoFrameClass: null }, /videoFrameClass must be a constructor/u],
		[{ ...valid, extra: 1 }, /unsupported field/u],
	] as const) {
		await assert.rejects(
			encodeVideoKeyframeFrames({ ...base, webCodecs: webCodecs as never }),
			message,
		);
	}
});

function decision(encoder: ReturnType<typeof recordingEncoder>, codec = 'avc1.4d001e') {
	return Object.freeze({
		codec,
		bitrate: 1_000_000,
		encoderClass: encoder.constructorFunction,
		videoFrameClass: FakeVideoFrame,
	});
}

class FakeVideoFrame {
	readonly timestamp: number;
	closed = false;

	constructor(_data: Uint8Array, init: Readonly<Record<string, unknown>>) {
		this.timestamp = Number(init.timestamp);
	}

	close() { this.closed = true; }
}

function recordingEncoder(options: Readonly<{ failOnFrame?: number }> = {}) {
	const timestamps: number[] = [];
	const keyFrames: boolean[] = [];
	const record = {
		timestamps,
		keyFrames,
		configured: null as Readonly<Record<string, unknown>> | null,
		closed: false,
		constructorFunction: null as unknown,
	};
	class FakeVideoEncoder {
		state = 'unconfigured';
		encodeQueueSize = 0;
		readonly #output: (chunk: { byteLength: number; copyTo(target: Uint8Array): void }) => void;
		readonly #error: (error: unknown) => void;

		constructor(callbacks: Readonly<{
			output: (chunk: { byteLength: number; copyTo(target: Uint8Array): void }) => void;
			error: (error: unknown) => void;
		}>) {
			this.#output = callbacks.output;
			this.#error = callbacks.error;
		}

		configure(config: Readonly<Record<string, unknown>>) {
			record.configured = config;
			this.state = 'configured';
		}

		encode(frame: FakeVideoFrame, encodeOptions?: Readonly<{ keyFrame?: boolean }>) {
			timestamps.push(frame.timestamp);
			keyFrames.push(encodeOptions?.keyFrame === true);
			if (options.failOnFrame === timestamps.length - 1) {
				this.#error(new Error('the encoder gave up'));
				return;
			}
			const bytes = new Uint8Array(8).fill(timestamps.length);
			this.#output({
				byteLength: bytes.byteLength,
				copyTo(target: Uint8Array) { target.set(bytes); },
			});
		}

		async flush() { await Promise.resolve(); }

		close() {
			record.closed = true;
			this.state = 'closed';
		}
	}
	record.constructorFunction = FakeVideoEncoder;
	return record;
}

function source(options: Readonly<{ width: number; height: number; frameRate: number }>) {
	const project = createFramescaperProjectV20(PROFILE, framescaperV20Options());
	const compatible = structuredClone(project) as Record<string, unknown>;
	compatible.schemaVersion = 17;
	return createVideoKeyframeExportFrameSource({
		project: resolveRuntimeProjectProjection(compatible),
		canvas: options,
		startFrame: 0,
		endFrame: 48_000,
	});
}

function producerFor(frameSource: VideoKeyframeExportFrameSource): VideoKeyframeRgbaFrameProducer {
	return Object.freeze({
		width: frameSource.canvas.width,
		height: frameSource.canvas.height,
		byteLength: frameSource.canvas.width * frameSource.canvas.height * 4,
		produce(frame: VideoKeyframeExportFrame, target: Uint8Array) { target.fill(frame.index); },
		dispose() {},
	});
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
	const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const output = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

function fakeFfmpeg() {
	const events: string[] = [];
	const writes: Uint8Array[] = [];
	let resolveExecution: ((code: number) => void) | null = null;
	const record = {
		events,
		writes,
		arguments: [] as readonly string[],
		async createInputStream(path: string, capacityBytes: number) {
			events.push('create');
			return Object.freeze({
				path,
				capacityBytes,
				async write(chunk: Uint8Array) {
					events.push('write');
					await Promise.resolve();
					writes.push(chunk.slice());
				},
				async close() { events.push('close'); resolveExecution?.(0); },
				abort() { events.push('abort'); resolveExecution?.(1); },
				async dispose() { events.push('stream-dispose'); },
			});
		},
		exec(arguments_: readonly string[]) {
			events.push('exec');
			record.arguments = arguments_;
			return new Promise<number>((resolve) => { resolveExecution = resolve; });
		},
		terminateExecution() { events.push('terminate-execution'); },
	};
	return record;
}
