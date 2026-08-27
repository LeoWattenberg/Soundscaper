/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoExactPictureExportFrameSource,
	type VideoKeyframeExportFrame,
} from '../src/common/editor/video-keyframe-export-frame-source.ts';
import {
	encodeVideoKeyframeVideo,
	encodeVideoKeyframeVideoToSink,
	type VideoKeyframeVideoEncoderDependencies,
} from '../src/common/editor/video-keyframe-video-encoder.ts';

const TOKEN = 'abcdef0123456789abcdef0123456789';
const MP4 = Uint8Array.of(
	0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0,
	0, 0, 0, 9, 0x6d, 0x6f, 0x6f, 0x76, 0,
	0, 0, 0, 9, 0x6d, 0x64, 0x61, 0x74, 0,
);
const WEBM = Uint8Array.of(
	0x1a, 0x45, 0xdf, 0xa3, 0x87, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d,
	0x18, 0x53, 0x80, 0x67, 0x8c,
	0x16, 0x54, 0xae, 0x6b, 0x81, 0,
	0x1f, 0x43, 0xb6, 0x75, 0x81, 0,
);

test('WebCodecs byte delivery bypasses the FFmpeg owner and retains normal container evidence', async () => {
	for (const [format, bytes, codec] of [
		['mp4', MP4, 'avc1.4d001f'],
		['webm', WEBM, 'vp09.00.10.08'],
	] as const) {
		const fixture = nativeFixture(format, bytes, codec);
		const result = await encodeVideoKeyframeVideo(null as never, fixture.request, fixture.dependencies);

		assert.deepEqual([...result.bytes], [...bytes]);
		assert.equal(result.videoEncoder, 'webcodecs');
		assert.equal(result.codec, codec);
		assert.equal(result.outputChunkCount, Math.ceil(bytes.byteLength / 5));
		assert.equal(fixture.executions(), 1);
		assert.equal(fixture.disposals(), 1);
		assert.equal(fixture.workloadTier(), 'webcodecs');
		assert.equal(fixture.nativeBytes().every((value) => value === 0), true,
			'native staging is cleared after the evidence-owned copy is delivered');
	}
});

test('WebCodecs sink delivery opens with the exact generated size and streams bounded chunks', async () => {
	const fixture = nativeFixture('mp4', MP4, 'avc1.4d001f');
	const written: number[] = [];
	let opened = 0;
	let aborts = 0;
	const result = await encodeVideoKeyframeVideoToSink(null as never, fixture.request, {
		async open(size) { opened = size; },
		async write(chunk) { written.push(...chunk); },
		async close() { return 'native-destination' as const; },
		async abort() { aborts += 1; },
	}, fixture.dependencies);

	assert.equal(result.output, 'native-destination');
	assert.equal(opened, MP4.byteLength);
	assert.deepEqual(written, [...MP4]);
	assert.equal(result.outputChunkCount, Math.ceil(MP4.byteLength / 5));
	assert.equal(aborts, 0);
	assert.equal(fixture.executions(), 1);
	assert.equal(fixture.disposals(), 1);
});

test('the default lazy backend writes finite Mediabunny containers from browser chunks', async () => {
	for (const [format, codec] of [
		['mp4', 'avc1.42001e'],
		['webm', 'vp09.00.10.08'],
	] as const) {
		const frameSource = createVideoExactPictureExportFrameSource({
			sampleRate: 48_000,
			startFrame: 0,
			endFrame: 48_000,
			canvas: { width: 4, height: 2, frameRate: 1 },
		});
		const encoder = fakeEncoder(format);
		const result = await encodeVideoKeyframeVideo(null as never, {
			frameSource,
			producer: {
				width: 4, height: 2, byteLength: 32,
				produce(_frame: VideoKeyframeExportFrame, target: Uint8Array) { target.fill(1); },
				dispose() {},
			},
			format,
			webCodecs: {
				codec,
				bitrate: 100_000,
				encoderClass: encoder.Encoder,
				videoFrameClass: encoder.Frame,
			},
		}, { createJobToken: () => TOKEN });

		assert.equal(result.videoEncoder, 'webcodecs');
		assert.equal(result.bytes.byteLength > 100, true);
		assert.deepEqual(
			[...result.bytes.subarray(format === 'mp4' ? 4 : 0, format === 'mp4' ? 8 : 4)],
			format === 'mp4' ? [...new TextEncoder().encode('ftyp')] : [0x1a, 0x45, 0xdf, 0xa3],
		);
		assert.deepEqual(encoder.configs[0]?.avc, format === 'mp4' ? { format: 'avc' } : undefined);
	}
});

function nativeFixture(format: 'mp4' | 'webm', container: Uint8Array, codec: string) {
	const frameSource = createVideoExactPictureExportFrameSource({
		sampleRate: 48_000,
		startFrame: 0,
		endFrame: 48_000,
		canvas: { width: 4, height: 2, frameRate: 1 },
	});
	let disposals = 0;
	let executions = 0;
	let workloadTier = '';
	let nativeBytes = new Uint8Array();
	const dependencies: VideoKeyframeVideoEncoderDependencies = {
		createJobToken: () => TOKEN,
		async executeBrowserWebCodecs(request) {
			executions += 1;
			workloadTier = request.workload.videoEncoder;
			nativeBytes = container.slice();
			return {
				bytes: nativeBytes,
				byteLength: nativeBytes.byteLength,
				videoEncoder: 'webcodecs',
				codec,
				frameCount: request.workload.frameCount,
				frameBytes: request.workload.frameBytes,
				totalRgbaBytes: request.workload.totalRgbaBytes,
				videoByteLength: 3,
				chunkCount: 1,
				format,
				extension: format === 'mp4' ? '.mp4' : '.webm',
				mimeType: format === 'mp4' ? 'video/mp4' : 'video/webm',
				decoderConfigObserved: true,
			};
		},
	};
	return {
		request: {
			frameSource,
			producer: {
				width: 4,
				height: 2,
				byteLength: 32,
				produce(frame: VideoKeyframeExportFrame, target: Uint8Array) { target.fill(frame.index); },
				dispose() { disposals += 1; },
			},
			format,
			webCodecs: {
				codec,
				bitrate: 100_000,
				encoderClass: class {},
				videoFrameClass: class {},
			},
			maximumOutputChunkBytes: 5,
		},
		dependencies,
		disposals: () => disposals,
		executions: () => executions,
		workloadTier: () => workloadTier,
		nativeBytes: () => nativeBytes,
	};
}

function fakeEncoder(format: 'mp4' | 'webm') {
	const configs: Record<string, unknown>[] = [];
	const avcc = Uint8Array.of(
		1, 66, 0, 30, 255, 225, 0, 9, 103, 66, 0, 30, 244, 75, 32, 1, 16,
		1, 0, 4, 104, 206, 60, 128,
	);
	class Frame {
		readonly timestamp: number;
		readonly duration: number;

		constructor(_data: Uint8Array, init: Readonly<Record<string, unknown>>) {
			this.timestamp = init.timestamp as number;
			this.duration = init.duration as number;
		}

		close() {}
	}
	class Encoder {
		readonly callbacks: Readonly<{
			output(chunk: Readonly<Record<string, unknown>>, metadata?: EncodedVideoChunkMetadata): void;
			error(error: unknown): void;
		}>;
		state = 'configured';
		encodeQueueSize = 0;

		constructor(callbacks: Encoder['callbacks']) { this.callbacks = callbacks; }
		configure(config: Record<string, unknown>) { configs.push(config); }
		encode(frame: Frame) {
			const data = format === 'mp4'
				? Uint8Array.of(0, 0, 0, 2, 101, 136)
				: Uint8Array.of(130, 0, 0);
			this.callbacks.output({
				byteLength: data.byteLength,
				type: 'key',
				timestamp: frame.timestamp,
				duration: frame.duration,
				copyTo(target: Uint8Array) { target.set(data); },
			}, {
				decoderConfig: {
					codec: format === 'mp4' ? 'avc1.42001e' : 'vp09.00.10.08',
					codedWidth: 4,
					codedHeight: 2,
					...(format === 'mp4' ? { description: avcc } : {}),
				},
			});
		}
		async flush() {}
		close() { this.state = 'closed'; }
	}
	return { Encoder, Frame, configs };
}
