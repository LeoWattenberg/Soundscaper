/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeWav } from '../src/common/editor/wav.js';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import {
	createVideoKeyframeExportFrameSource,
	type VideoKeyframeExportFrameSource,
} from '../src/common/editor/video-keyframe-export-frame-source.ts';
import {
	admitVideoKeyframeEncoderWorkload,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_AGGREGATE_RING_BYTES,
	VIDEO_KEYFRAME_ENCODER_MAXIMUM_AUDIO_FRAME_RATE,
} from '../src/common/editor/video-keyframe-encoder-stream.ts';
import {
	encodeVideoKeyframeVideo,
	type VideoKeyframeEncoderOperationLease,
	type VideoKeyframeVideoEditorFfmpeg,
} from '../src/common/editor/video-keyframe-video-encoder.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import { FRAMESCAPER_V20_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-v20-profile.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const TOKEN = 'abcdef0123456789abcdef0123456789';
const MP4 = Uint8Array.of(
	0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
	0, 0, 0, 9, 0x6d, 0x6f, 0x6f, 0x76, 0,
	0, 0, 0, 9, 0x6d, 0x64, 0x61, 0x74, 0,
);

test('A/V admission owns exact MP4 and WebM command shapes under a 16 MiB aggregate ring cap', () => {
	const frameSource = source();
	for (const [format, audioCodec, bitRate, paddedSamples] of [
		['mp4', 'aac', '192k', 48_128],
		['webm', 'libopus', '160k', 48_000],
	] as const) {
		const extension = format === 'mp4' ? 'mp4' : 'webm';
		const admitted = admitVideoKeyframeEncoderWorkload({
			frameSource,
			format,
			inputPath: '/frames.rgba',
			audioInputPath: '/mix.wav',
			outputPath: `/encoded.${extension}`,
			ringCapacityBytes: 8 * 1024 * 1024,
			audioRingCapacityBytes: 8 * 1024 * 1024,
		});
		assert.equal(admitted.audioInputPath, '/mix.wav');
		assert.equal(admitted.audioRingCapacityBytes, 8 * 1024 * 1024);
		assert.equal(admitted.aggregateRingCapacityBytes, 16 * 1024 * 1024);
		assert.deepEqual(admitted.ffmpegArguments.slice(0, 14), [
			'-nostdin', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba',
			'-video_size', '2x2', '-framerate', '1/1', '-i', '/frames.rgba',
			'-i', '/mix.wav',
		]);
		assert.equal(admitted.ffmpegArguments.includes('-frames:v'), false);
		assert.deepEqual(
			admitted.ffmpegArguments.slice(14, 16),
			['-filter:a', `apad=whole_len=${String(paddedSamples)}`],
		);
		assert.deepEqual(
			admitted.ffmpegArguments.slice(
				admitted.ffmpegArguments.indexOf('-map'),
				admitted.ffmpegArguments.indexOf('-map_metadata'),
			),
			['-map', '0:v:0', '-map', '1:a:0'],
		);
		assert.deepEqual(
			admitted.ffmpegArguments.slice(
				admitted.ffmpegArguments.indexOf('-c:a'),
				admitted.ffmpegArguments.indexOf('-c:a') + 4,
			),
			['-c:a', audioCodec, '-b:a', bitRate],
		);
		assert.equal(admitted.ffmpegArguments.includes('-an'), false);
		assert.deepEqual(admitted.ffmpegArguments.slice(-3), ['-t', '1.000000000', `/encoded.${extension}`]);
	}
	assert.equal(VIDEO_KEYFRAME_ENCODER_MAXIMUM_AGGREGATE_RING_BYTES, 16 * 1024 * 1024);
	assert.equal(VIDEO_KEYFRAME_ENCODER_MAXIMUM_AUDIO_FRAME_RATE, 30);
	for (const [format, rangeFrames, expectedPad] of [
		['mp4', 1_025, 2_048],
		['webm', 961, 1_920],
	] as const) {
		const admitted = admitVideoKeyframeEncoderWorkload({
			frameSource: source(rangeFrames, 30),
			format,
			inputPath: '/frames.rgba',
			audioInputPath: '/mix.wav',
			outputPath: `/encoded.${format}`,
		});
		assert.equal(admitted.ffmpegArguments.includes(`apad=whole_len=${String(expectedPad)}`), true);
		assert.deepEqual(admitted.ffmpegArguments.slice(-3), ['-t', '0.033333334', `/encoded.${format}`]);
	}
	assert.throws(() => admitVideoKeyframeEncoderWorkload({
		frameSource,
		format: 'mp4',
		inputPath: '/frames.rgba',
		outputPath: '/encoded.mp4',
		audioRingCapacityBytes: 4_096,
	}), /audioRingCapacityBytes.*audioInputPath/u);
	assert.throws(() => admitVideoKeyframeEncoderWorkload({
		frameSource,
		format: 'mp4',
		inputPath: '/frames.rgba',
		audioInputPath: '/frames.rgba',
		outputPath: '/encoded.mp4',
	}), /input paths must differ/u);
	assert.throws(() => admitVideoKeyframeEncoderWorkload({
		frameSource: source(1_025, { num: 1_920, den: 41 }),
		format: 'mp4',
		inputPath: '/frames.rgba',
		audioInputPath: '/mix.wav',
		outputPath: '/encoded.mp4',
	}), /A\/V frame rate must be 1 through 30/u);
});

test('an authenticated float32 WAV is sliced into the second bounded stream without a file-sized copy', async () => {
	const frameSource = source();
	const audioMix = floatWav(frameSource.endFrame - frameSource.startFrame);
	const fake = avFfmpeg(MP4);
	const result = await encodeVideoKeyframeVideo(fake.port, {
		frameSource,
		producer: producer(frameSource),
		format: 'mp4',
		audioMix,
		ringCapacityBytes: 4_096,
		audioRingCapacityBytes: 4_096,
	}, { createJobToken: () => TOKEN });

	assert.equal(result.audioByteLength, audioMix.size);
	assert.equal(result.audioChunkCount, Math.ceil(audioMix.size / 4_096));
	assert.deepEqual(fake.capacities(), [4_096, 4_096]);
	assert.equal(Math.max(...fake.audioWrites().map((chunk) => chunk.byteLength)) <= 4_096, true);
	assert.equal(fake.audioWrites().reduce((total, chunk) => total + chunk.byteLength, 0), audioMix.size);
	assert.deepEqual(fake.events().slice(0, 4), ['lease-start', 'create-video', 'create-audio', 'exec']);
	assert.equal(fake.arguments_().includes('/framescaper-keyframes-abcdef0123456789abcdef0123456789.wav'), true);
	assert.equal(fake.events().includes('dispose-video'), true);
	assert.equal(fake.events().includes('dispose-audio'), true);
	assert.deepEqual(fake.events().slice(-2), ['delete-output', 'lease-end']);
});

test('integer PCM is rejected before lease acquisition and audio failure aborts both rings and execution', async () => {
	const frameSource = source();
	const before = avFfmpeg(MP4);
	await assert.rejects(encodeVideoKeyframeVideo(before.port, {
		frameSource,
		producer: producer(frameSource),
		format: 'mp4',
		audioMix: integerWav(),
	}, { createJobToken: () => TOKEN }), /float32 WAV/u);
	assert.equal(before.runCalls(), 0);
	const slowRate = avFfmpeg(MP4);
	const slowFrameSource = source(1, { num: 1, den: 1_000_000 });
	await assert.rejects(encodeVideoKeyframeVideo(slowRate.port, {
		frameSource: slowFrameSource,
		producer: producer(slowFrameSource),
		format: 'mp4',
		audioMix: floatWav(1),
	}, { createJobToken: () => TOKEN }), /A\/V frame rate must be 1 through 30/u);
	assert.equal(slowRate.runCalls(), 0);
	for (const [audioMix, match] of [
		[floatWav(frameSource.endFrame - frameSource.startFrame - 1), /frame count.*exact export range/u],
		[floatWav(frameSource.endFrame - frameSource.startFrame, 44_100), /sample rate.*project sample rate/u],
	] as const) {
		const mismatch = avFfmpeg(MP4);
		await assert.rejects(encodeVideoKeyframeVideo(mismatch.port, {
			frameSource,
			producer: producer(frameSource),
			format: 'mp4',
			audioMix,
		}, { createJobToken: () => TOKEN }), match);
		assert.equal(mismatch.runCalls(), 0);
	}

	const failure = new Error('audio ring failed');
	const during = avFfmpeg(MP4, { audioWriteFailure: failure, neverSettleExecution: true });
	await assert.rejects(encodeVideoKeyframeVideo(during.port, {
		frameSource,
		producer: producer(frameSource),
		format: 'mp4',
		audioMix: floatWav(frameSource.endFrame - frameSource.startFrame),
		ringCapacityBytes: 4_096,
		audioRingCapacityBytes: 4_096,
	}, { createJobToken: () => TOKEN }), (error: unknown) => flatten(error).includes(failure));
	assert.equal(during.events().includes('abort-video'), true);
	assert.equal(during.events().includes('abort-audio'), true);
	assert.equal(during.events().includes('terminate-execution'), true);
	assert.equal(during.events().includes('dispose-video'), true);
	assert.equal(during.events().includes('dispose-audio'), true);
});

function source(
	endFrame = 48_000,
	frameRate: number | Readonly<{ num: number; den: number }> = 1,
): VideoKeyframeExportFrameSource {
	const project = createFramescaperProjectV20(
		FRAMESCAPER_V20_PROJECT_MODEL_PROFILE,
		framescaperV20Options(),
	);
	const compatible = structuredClone(project) as Record<string, unknown>;
	compatible.schemaVersion = 17;
	return createVideoKeyframeExportFrameSource({
		project: resolveRuntimeProjectProjection(compatible),
		canvas: { width: 2, height: 2, frameRate },
		startFrame: 0,
		endFrame,
	});
}

function producer(frameSource: VideoKeyframeExportFrameSource) {
	return Object.freeze({
		width: frameSource.canvas.width,
		height: frameSource.canvas.height,
		byteLength: frameSource.canvas.width * frameSource.canvas.height * 4,
		produce(_frame: unknown, target: Uint8Array) { target.fill(1); },
		dispose() {},
	});
}

function floatWav(frameCount: number, sampleRate = 48_000): Blob {
	const bytes = Uint8Array.from(encodeWav([
		new Float32Array(frameCount),
		new Float32Array(frameCount),
	], { sampleRate, bitDepth: 32, float: true, dither: 'none' }));
	return new Blob([bytes.buffer], { type: 'audio/wav' });
}

function integerWav(): Blob {
	const bytes = Uint8Array.from(encodeWav([
		new Float32Array(8),
		new Float32Array(8),
	], { sampleRate: 48_000, bitDepth: 16, float: false, dither: 'none' }));
	return new Blob([bytes.buffer], { type: 'audio/wav' });
}

interface FakeOptions {
	readonly audioWriteFailure?: Error;
	readonly neverSettleExecution?: boolean;
}

function avFfmpeg(encoded: Uint8Array, options: FakeOptions = {}) {
	const events: string[] = [];
	const capacities: number[] = [];
	const audioWrites: Uint8Array[] = [];
	let runs = 0;
	let arguments_: readonly string[] = [];
	const closed = new Set<string>();
	let resolveExecution: ((code: number) => void) | null = null;
	const port: VideoKeyframeVideoEditorFfmpeg = Object.freeze({
		async runVideoKeyframeEncoderOperation<Output>(
			operation: (lease: VideoKeyframeEncoderOperationLease) => PromiseLike<Output> | Output,
		): Promise<Output> {
			runs += 1;
			events.push('lease-start');
			let terminated = false;
			const lease: VideoKeyframeEncoderOperationLease = Object.freeze({
				async createInputStream(path: string, capacityBytes = 1024 * 1024) {
					const kind = path.endsWith('.wav') ? 'audio' : 'video';
					capacities.push(capacityBytes);
					events.push(`create-${kind}`);
					return Object.freeze({
						path,
						capacityBytes,
						async write(chunk: Uint8Array) {
							events.push(`write-${kind}`);
							if (kind === 'audio') {
								if (options.audioWriteFailure) throw options.audioWriteFailure;
								audioWrites.push(chunk.slice());
							}
						},
						async close() {
							events.push(`close-${kind}`);
							closed.add(kind);
							if (closed.size === 2 && !options.neverSettleExecution) resolveExecution?.(0);
						},
						abort() { events.push(`abort-${kind}`); },
						async dispose() { events.push(`dispose-${kind}`); },
					});
				},
				exec(value: readonly string[]) {
					arguments_ = value;
					events.push('exec');
					return new Promise<number>((resolve) => { resolveExecution = resolve; });
				},
				terminateExecution() { terminated = true; events.push('terminate-execution'); },
				isExecutionTerminated() { return terminated; },
				async statFile() { events.push('stat-output'); return { size: encoded.byteLength }; },
				async readFileRange(_path: string, offset: number, maximumBytes: number) {
					return encoded.slice(offset, offset + maximumBytes);
				},
				async deleteFile() { events.push('delete-output'); },
			});
			try { return await operation(lease); } finally { events.push('lease-end'); }
		},
	});
	return Object.freeze({
		port,
		events: () => [...events],
		capacities: () => [...capacities],
		audioWrites: () => [...audioWrites],
		arguments_: () => [...arguments_],
		runCalls: () => runs,
	});
}

function flatten(error: unknown): unknown[] {
	return error instanceof AggregateError
		? [error, ...error.errors.flatMap((item: unknown) => flatten(item))]
		: [error];
}
