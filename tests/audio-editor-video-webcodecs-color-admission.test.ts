/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRequest } from '../src/common/editor/video-keyframe-video-encoder-admission.ts';
import { admitVideoKeyframeEncoderWorkload, encodeVideoKeyframeFrames } from '../src/common/editor/video-keyframe-encoder-stream.ts';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { executeVideoKeyframeMediabunnyEncoder, type VideoKeyframeMediabunnyExecutionDependencies } from '../src/common/editor/video-keyframe-mediabunny-execution.ts';
import { encodeVideoKeyframeOfflineVideo } from '../src/common/editor/ui/video-keyframe-offline-video-export.ts';
import { exportFixture, harnessDependencies, encodedResult, RATE, SOURCE_ID } from './helpers/video-keyframe-offline-export-harness.ts';

for (const space of ['srgb', 'rec709'] as const) {
	test(`offline keyed admission carries ${space} through the actual encoder request`, async () => {
		const fixture = await exportFixture();
		const events: string[] = [];
		const base = harnessDependencies(events);
		const encoder = Object.getOwnPropertyDescriptor(globalThis, 'VideoEncoder');
		const frame = Object.getOwnPropertyDescriptor(globalThis, 'VideoFrame');
		Object.defineProperty(globalThis, 'VideoEncoder', { configurable: true, value: class {} });
		Object.defineProperty(globalThis, 'VideoFrame', { configurable: true, value: class {} });
		try {
			await encodeVideoKeyframeOfflineVideo({
				project: fixture.project, timingBySourceId: fixture.timing, sources: [{ sourceId: SOURCE_ID, blob: fixture.blob }],
				canvas: { width: 64, height: 32, frameRate: RATE }, format: 'mp4',
				webCodecs: { codec: 'avc1.4d001e', bitrate: 737, rgbaColorSpace: space },
				signal: new AbortController().signal, assertCurrent() {},
			} as never, { ...base, async encodeVideo(_runtime, request) {
				assert.equal((request.webCodecs as unknown as Record<string, unknown>).rgbaColorSpace, space);
				return encodedResult();
			} });
		} finally {
			if (encoder) Object.defineProperty(globalThis, 'VideoEncoder', encoder); else Reflect.deleteProperty(globalThis, 'VideoEncoder');
			if (frame) Object.defineProperty(globalThis, 'VideoFrame', frame); else Reflect.deleteProperty(globalThis, 'VideoFrame');
		}
	});
}

test('direct native admission freezes declared profile before later reads and refuses future/getter facts', () => {
	const request = nativeRequest();
	const decision = { ...request.webCodecs, rgbaColorSpace: 'rec709' };
	const normalized = normalizeRequest({ ...request, webCodecs: decision } as never);
	decision.rgbaColorSpace = 'srgb';
	assert.equal((normalized.webCodecs as unknown as Record<string, unknown>).rgbaColorSpace, 'rec709');
	assert.equal(Object.isFrozen(normalized.webCodecs), true);
	let reads = 0;
	for (const webCodecs of [
		{ ...request.webCodecs, rgbaColorSpace: 'display-p3' },
		Object.defineProperty({ ...request.webCodecs }, 'rgbaColorSpace', { enumerable: true, get() { reads++; return 'srgb'; } }),
	]) assert.throws(() => normalizeRequest({ ...request, webCodecs } as never));
	assert.equal(reads, 0);
});

test('Mediabunny captures the profile before muxer work and forwards native metadata untouched', async () => {
	const request = nativeRequest();
	const webCodecs = { ...request.webCodecs, rgbaColorSpace: 'rec709' };
	const metadata: EncodedVideoChunkMetadata = { decoderConfig: { codec: 'avc1.4d001e', colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false } } };
	let received: unknown;
	const dependencies: VideoKeyframeMediabunnyExecutionDependencies = {
		createMuxer() {
			webCodecs.rgbaColorSpace = 'srgb';
			return { async start() {}, async addVideoChunk(_chunk, actual) { received = actual; }, async addAudioPcm() {},
				async finalize() { return { bytes: Uint8Array.of(1), videoChunkCount: 1, videoByteLength: 1, audioChunkCount: 0, audioFrameCount: 0, decoderConfigObserved: true }; }, async cancel() {} };
		},
		async produceVideo(actual) {
			assert.equal((actual as unknown as Record<string, unknown>).rgbaColorSpace, 'rec709');
			await actual.writeChunk({ byteLength: 1, type: 'key', timestamp: 0, copyTo(target) { target[0] = 1; } }, metadata);
			return { frameCount: 1, chunkCount: 1, byteLength: 1 };
		},
	};
	await executeVideoKeyframeMediabunnyEncoder({ ...request, webCodecs, workload: workload(request.frameSource) } as never, dependencies);
	assert.equal(received, metadata);
});

test('future native profiles refuse before muxer creation', async () => {
	const request = nativeRequest();
	let entered = 0;
	await assert.rejects(executeVideoKeyframeMediabunnyEncoder({ ...request,
		webCodecs: { ...request.webCodecs, rgbaColorSpace: 'linear-rec709-d65' }, workload: workload(request.frameSource) } as never,
		{ createMuxer() { entered++; throw new Error('should not create muxer'); }, produceVideo() { throw new Error('should not encode'); } }), /color|profile|rgbaColorSpace/iu);
	assert.equal(entered, 0);
});

test('legacy stream uses the declared profile without rewriting its FFmpeg command', async () => {
	const request = nativeRequest();
	const inits: Record<string, unknown>[] = [];
	let output!: (chunk: { byteLength: number; type: 'key'; timestamp: number; copyTo(target: Uint8Array): void }) => void;
	class Encoder {
		state = 'configured'; encodeQueueSize = 0;
		constructor(callbacks: { output: typeof output }) { output = callbacks.output; }
		configure() {}
		encode() { output({ byteLength: 1, type: 'key', timestamp: 0, copyTo(target) { target[0] = 1; } }); }
		async flush() {}
		close() { this.state = 'closed'; }
	}
	let complete!: (code: number) => void;
	let actualArguments: readonly string[] = [];
	const ffmpeg = {
		async createInputStream(path: string, capacityBytes: number) { return { path, capacityBytes,
			async write() {}, async close() { complete(0); }, abort() { complete(1); }, async dispose() {} }; },
		exec(args: readonly string[]) { actualArguments = args; return new Promise<number>(resolve => { complete = resolve; }); }, terminateExecution() {},
	};
	const result = await encodeVideoKeyframeFrames({ ...request, ffmpeg,
		inputPath: '/video.h264', outputPath: '/output.mp4',
		webCodecs: { ...request.webCodecs, rgbaColorSpace: 'rec709', encoderClass: Encoder,
			videoFrameClass: class { constructor(_bytes: Uint8Array, init: Record<string, unknown>) { inits.push(init); } close() {} },
		} } as never);
	assert.equal(result.frameCount, 1);
	assert.equal(inits[0]?.format, 'I420');
	assert.deepEqual(inits[0]?.colorSpace, { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false });
	assert.deepEqual(actualArguments, workload(request.frameSource).ffmpegArguments);
});

function nativeRequest() {
	const frameSource = createVideoExactPictureExportFrameSource({ sampleRate: 48_000, startFrame: 0, endFrame: 48_000,
		canvas: { width: 4, height: 2, frameRate: 1 } });
	return { frameSource, format: 'mp4' as const,
		producer: { width: 4, height: 2, byteLength: 32, produce() {}, dispose() {} },
		webCodecs: { codec: 'avc1.4d001e', bitrate: 737, encoderClass: class {}, videoFrameClass: class {} } };
}

function workload(frameSource: ReturnType<typeof nativeRequest>['frameSource']) {
	return admitVideoKeyframeEncoderWorkload({ frameSource, format: 'mp4', videoEncoder: 'webcodecs', inputPath: '/video.h264', outputPath: '/output.mp4' });
}
