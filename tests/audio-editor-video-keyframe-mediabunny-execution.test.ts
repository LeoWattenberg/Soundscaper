/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { admitVideoKeyframeAudioInput } from '../src/common/editor/video-keyframe-audio-input.ts';
import { admitVideoKeyframeEncoderWorkload } from '../src/common/editor/video-keyframe-encoder-stream.ts';
import {
	createVideoExactPictureExportFrameSource,
	type VideoKeyframeExportFrame,
} from '../src/common/editor/video-keyframe-export-frame-source.ts';
import {
	executeVideoKeyframeMediabunnyEncoder,
	type VideoKeyframeMediabunnyExecutionDependencies,
} from '../src/common/editor/video-keyframe-mediabunny-execution.ts';
import type { VideoMediabunnyMuxRequest } from '../src/common/editor/video-mediabunny-muxer.ts';

test('direct execution produces complete H.264/AAC MP4 and VP9/Opus WebM profiles', async () => {
	for (const profile of [
		{ format: 'mp4', videoCodec: 'h264', audioCodec: 'aac', audioPacketFrames: 1_024 },
		{ format: 'webm', videoCodec: 'vp9', audioCodec: 'opus', audioPacketFrames: 960 },
	] as const) {
		const frameSource = createVideoExactPictureExportFrameSource({
			sampleRate: 48_000,
			startFrame: 0,
			endFrame: 48_000,
			canvas: { width: 4, height: 2, frameRate: 1 },
		});
		const audioSource = await admitVideoKeyframeAudioInput(floatWav(48_000, 2, 48_000));
		const workload = admitVideoKeyframeEncoderWorkload({
			frameSource,
			format: profile.format,
			videoEncoder: 'webcodecs',
			inputPath: profile.format === 'mp4' ? '/video.h264' : '/video.ivf',
			audioInputPath: '/audio.wav',
			outputPath: profile.format === 'mp4' ? '/output.mp4' : '/output.webm',
		});
		const harness = executionHarness();
		const result = await executeVideoKeyframeMediabunnyEncoder({
			workload,
			frameSource,
			producer: {
				width: 4,
				height: 2,
				byteLength: 32,
				produce(frame: VideoKeyframeExportFrame, target: Uint8Array) { target.fill(frame.index + 1); },
				dispose() {},
			},
			webCodecs: {
				codec: profile.format === 'mp4' ? 'avc1.4d001f' : 'vp09.00.10.08',
				bitrate: 100_000,
				encoderClass: class {},
				videoFrameClass: class {},
			},
			audioSource,
			audioBitrate: 192_000,
		}, harness.dependencies);

		assert.equal(harness.muxRequest?.videoCodec, profile.videoCodec);
		assert.equal(harness.muxRequest?.audio?.codec, profile.audioCodec);
		assert.equal(harness.produceRequest?.h264Format, 'avc');
		assert.equal(harness.videoMetadata, harness.emittedMetadata);
		assert.equal(harness.audioFrames, 48_000);
		assert.equal(harness.audioChunks, Math.ceil(48_000 / profile.audioPacketFrames));
		assert.deepEqual([...result.bytes], [1, 2, 3, 4]);
		assert.equal(result.videoEncoder, 'webcodecs');
		assert.equal(result.audioByteLength, audioSource.byteLength);
		assert.equal(result.decoderConfigObserved, true);
		assert.equal(harness.canceled, 0);
	}
});

test('a failed native mux is canceled and never returned as a short success', async () => {
	const frameSource = createVideoExactPictureExportFrameSource({
		sampleRate: 48_000,
		startFrame: 0,
		endFrame: 48_000,
		canvas: { width: 4, height: 2, frameRate: 1 },
	});
	const workload = admitVideoKeyframeEncoderWorkload({
		frameSource,
		format: 'mp4',
		videoEncoder: 'webcodecs',
		inputPath: '/video.h264',
		outputPath: '/output.mp4',
	});
	const harness = executionHarness({ finalizeFailure: new Error('mux failed') });
	await assert.rejects(executeVideoKeyframeMediabunnyEncoder({
		workload,
		frameSource,
		producer: {
			width: 4, height: 2, byteLength: 32,
			produce() {}, dispose() {},
		},
		webCodecs: {
			codec: 'avc1.4d001f', bitrate: 100_000,
			encoderClass: class {}, videoFrameClass: class {},
		},
	}, harness.dependencies), /mux failed/u);
	assert.equal(harness.canceled, 1);
});

test('a muxer whose start fails is canceled despite never reaching started state', async () => {
	const frameSource = createVideoExactPictureExportFrameSource({
		sampleRate: 48_000,
		startFrame: 0,
		endFrame: 48_000,
		canvas: { width: 4, height: 2, frameRate: 1 },
	});
	const workload = admitVideoKeyframeEncoderWorkload({
		frameSource,
		format: 'mp4',
		videoEncoder: 'webcodecs',
		inputPath: '/video.h264',
		outputPath: '/output.mp4',
	});
	const harness = executionHarness({ startFailure: new Error('start failed') });

	await assert.rejects(executeVideoKeyframeMediabunnyEncoder({
		workload,
		frameSource,
		producer: {
			width: 4, height: 2, byteLength: 32,
			produce() {}, dispose() {},
		},
		webCodecs: {
			codec: 'avc1.4d001f', bitrate: 100_000,
			encoderClass: class {}, videoFrameClass: class {},
		},
	}, harness.dependencies), /start failed/u);
	assert.equal(harness.canceled, 1);
});

test('an abort actively cancels a muxer whose finalization has not settled', {
	timeout: 2_000,
}, async () => {
	const frameSource = createVideoExactPictureExportFrameSource({
		sampleRate: 48_000,
		startFrame: 0,
		endFrame: 48_000,
		canvas: { width: 4, height: 2, frameRate: 1 },
	});
	const workload = admitVideoKeyframeEncoderWorkload({
		frameSource,
		format: 'webm',
		videoEncoder: 'webcodecs',
		inputPath: '/video.ivf',
		outputPath: '/output.webm',
	});
	const controller = new AbortController();
	const harness = executionHarness({ hangFinalize: true });
	const operation = executeVideoKeyframeMediabunnyEncoder({
		workload,
		frameSource,
		producer: {
			width: 4, height: 2, byteLength: 32,
			produce() {}, dispose() {},
		},
		webCodecs: {
			codec: 'vp09.00.10.08', bitrate: 100_000,
			encoderClass: class {}, videoFrameClass: class {},
		},
		signal: controller.signal,
	}, harness.dependencies);
	await harness.finalizeStarted;
	controller.abort();

	await assert.rejects(operation, (error: Error) => error.name === 'AbortError');
	assert.equal(harness.canceled, 1);
});

test('encoded video is rejected at its byte bound before container finalization', async () => {
	const frameSource = createVideoExactPictureExportFrameSource({
		sampleRate: 48_000,
		startFrame: 0,
		endFrame: 48_000,
		canvas: { width: 4, height: 2, frameRate: 1 },
	});
	const workload = admitVideoKeyframeEncoderWorkload({
		frameSource,
		format: 'webm',
		videoEncoder: 'webcodecs',
		inputPath: '/video.ivf',
		outputPath: '/output.webm',
	});
	const harness = executionHarness();

	await assert.rejects(executeVideoKeyframeMediabunnyEncoder({
		workload,
		frameSource,
		producer: {
			width: 4, height: 2, byteLength: 32,
			produce() {}, dispose() {},
		},
		webCodecs: {
			codec: 'vp09.00.10.08', bitrate: 100_000,
			encoderClass: class {}, videoFrameClass: class {},
		},
		maximumOutputBytes: 2,
	}, harness.dependencies), /exceeds.*byte bound/u);
	assert.equal(harness.finalized, 0);
	assert.equal(harness.canceled, 1);
});

function executionHarness(options: Readonly<{
	finalizeFailure?: Error;
	hangFinalize?: boolean;
	startFailure?: Error;
}> = {}) {
	let resolveFinalizeStarted!: () => void;
	const finalizeStarted = new Promise<void>((resolve) => { resolveFinalizeStarted = resolve; });
	const emittedMetadata = {
		decoderConfig: {
			codec: 'avc1.4d001f',
			description: Uint8Array.of(1, 2, 3),
		},
	} as EncodedVideoChunkMetadata;
	const harness = {
		muxRequest: null as VideoMediabunnyMuxRequest | null,
		produceRequest: null as Parameters<VideoKeyframeMediabunnyExecutionDependencies['produceVideo']>[0] | null,
		videoMetadata: undefined as EncodedVideoChunkMetadata | undefined,
		emittedMetadata,
		audioFrames: 0,
		audioChunks: 0,
		canceled: 0,
		finalized: 0,
		finalizeStarted,
		dependencies: null as unknown as VideoKeyframeMediabunnyExecutionDependencies,
	};
	harness.dependencies = {
		createMuxer(request) {
			harness.muxRequest = request;
			return {
				async start() {
					if (options.startFailure) throw options.startFailure;
				},
				async addVideoChunk(_chunk, metadata) { harness.videoMetadata = metadata; },
				async addAudioPcm(chunk) {
					harness.audioFrames += chunk.frameCount;
					harness.audioChunks += 1;
				},
				async finalize() {
					harness.finalized += 1;
					resolveFinalizeStarted();
					if (options.finalizeFailure) throw options.finalizeFailure;
					if (options.hangFinalize) await new Promise<never>(() => undefined);
					return {
						bytes: Uint8Array.of(1, 2, 3, 4),
						videoChunkCount: 1,
						videoByteLength: 3,
						audioChunkCount: harness.audioChunks,
						audioFrameCount: harness.audioFrames,
						decoderConfigObserved: true,
					};
				},
				async cancel() { harness.canceled += 1; },
			};
		},
		async produceVideo(request) {
			harness.produceRequest = request;
			const target = new Uint8Array(request.producer.byteLength);
			await request.producer.produce(request.frameSource.frame(0), target, {});
			const chunk = {
				byteLength: 3,
				type: 'key' as const,
				timestamp: 0,
				duration: 1_000_000,
				copyTo(output: Uint8Array) { output.set([9, 8, 7]); },
			};
			await request.writeChunk(chunk, emittedMetadata);
			return { frameCount: 1, chunkCount: 1, byteLength: 3 };
		},
	};
	return harness;
}

function floatWav(sampleRate: number, channelCount: number, frameCount: number): Blob {
	const dataBytes = frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT;
	const bytes = new Uint8Array(44 + dataBytes);
	const view = new DataView(bytes.buffer);
	text(bytes, 0, 'RIFF');
	view.setUint32(4, bytes.byteLength - 8, true);
	text(bytes, 8, 'WAVE');
	text(bytes, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, 3, true);
	view.setUint16(22, channelCount, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * channelCount * 4, true);
	view.setUint16(32, channelCount * 4, true);
	view.setUint16(34, 32, true);
	text(bytes, 36, 'data');
	view.setUint32(40, dataBytes, true);
	return new Blob([bytes], { type: 'audio/wav' });
}

function text(bytes: Uint8Array, offset: number, value: string): void {
	for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
}
