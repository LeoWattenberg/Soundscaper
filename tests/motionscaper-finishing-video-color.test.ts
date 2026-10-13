/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoExactPictureExportFrameSource } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import { encodeVideoKeyframeFrames } from '../src/common/editor/video-keyframe-encoder-stream.ts';
import { encodeVideoKeyframeVideo } from '../src/common/editor/video-keyframe-video-encoder.ts';
import { executeVideoKeyframeMediabunnyEncoder } from '../src/common/editor/video-keyframe-mediabunny-execution.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as finishingProfile } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { createFramescaperVideoExportStrategyFinishing } from '../src/framescaper/video-export-strategy-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { normalizeVideoRgbaOutput, videoI420ByteLength, videoRgbaI420Pixels } from '../src/common/editor/video-planar-pixels.ts';
import { produceVideoWebCodecsChunks, type VideoWebCodecsChunkProduceRequest } from '../src/common/editor/video-webcodecs-producer.ts';

// Structural container for the fake muxer; the real producer/plane path is exercised.
const structuralMp4 = Uint8Array.of(0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0, 0, 0, 0, 9, 109, 111, 111, 118, 0, 0, 0, 0, 9, 109, 100, 97, 116, 0);
const output = { encoding: 'rec709', alphaMode: 'straight', precision: 'unorm8' } as const;
const colorSpace = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };
function harness(color: readonly number[], options: { abort?: AbortController; failEncode?: boolean } = {}) {
	const frames: { bytes: Uint8Array; init: Readonly<Record<string, unknown>>; closed: number }[] = [];
	let closed = 0, writes = 0;
	let emit: ConstructorParameters<VideoWebCodecsChunkProduceRequest['encoderClass']>[0]['output'];
	class Frame {
		readonly captured: typeof frames[number];
		constructor(bytes: Uint8Array, init: Readonly<Record<string, unknown>>) {
			this.captured = { bytes: bytes.slice(), init, closed: 0 }; frames.push(this.captured);
		}
		close() { this.captured.closed++; }
	}
	class Encoder {
		state = 'configured'; encodeQueueSize = 0;
		constructor(callbacks: ConstructorParameters<VideoWebCodecsChunkProduceRequest['encoderClass']>[0]) { emit = callbacks.output; }
		configure() {}
		encode(frame: unknown) {
			assert.ok(frame instanceof Frame);
			if (options.failEncode) throw new Error('encode refused');
			options.abort?.abort();
			emit({ byteLength: 1, timestamp: Number(frame.captured.init.timestamp), type: 'key', copyTo(bytes) { bytes[0] = 1; } });
		}
		async flush() {}
		close() { this.state = 'closed'; closed++; }
	}
	const request: VideoWebCodecsChunkProduceRequest = {
		frameSource: { frameCount: 2, canvas: { width: 3, height: 1, frameRate: { num: 30000, den: 1001 } }, frame(index) { return index; } },
		producer: { byteLength: 12, produce(_frame, target) { for (let i = 0; i < target.length; i += 4) target.set(color, i); } },
		videoCodec: 'h264', codec: 'avc1.4d001f', bitrate: 8000000,
		encoderClass: Encoder, videoFrameClass: Frame, writeChunk() { writes++; },
		...(options.abort ? { signal: options.abort.signal } : {}),
	};
	return { request, frames, counts: () => ({ closed, writes }) };
}

test('Motion finishing export hands exact709 planes and metadata to the real common producer', async () => {
	const h = harness([0, 0, 255, 255]);
	await produceVideoWebCodecsChunks({ ...h.request, ...{ rgbaOutput: output } });
	assert.equal(h.frames.length, 2);
	for (const [index, frame] of h.frames.entries()) {
		assert.equal(frame.init.format, 'I420');
		assert.deepEqual([...frame.bytes], [32, 32, 32, 240, 240, 118, 118]);
		assert.deepEqual(frame.init.colorSpace, colorSpace);
		assert.equal(frame.init.codedWidth, 3); assert.equal(frame.init.codedHeight, 1);
		assert.equal(frame.init.timestamp, [0, 33367][index]); assert.equal(frame.init.duration, [33367, 33366][index]);
		assert.equal(frame.closed, 1);
	}
	assert.deepEqual(h.counts(), { closed: 1, writes: 2 });
});

test('Motion finishing planar encode retains close and cancellation semantics', async () => {
	for (const mode of ['abort', 'failure'] as const) {
		const h = harness([0, 0, 255, 255], mode === 'abort' ? { abort: new AbortController() } : { failEncode: true });
		await assert.rejects(produceVideoWebCodecsChunks({ ...h.request, ...{ rgbaOutput: output } }), mode === 'abort' ? /abort/iu : /encode refused/u);
		assert.equal(h.frames.length, 1); assert.equal(h.frames[0]!.init.format, 'I420');
		assert.equal(h.frames[0]!.closed, 1); assert.deepEqual(h.counts(), { closed: 1, writes: mode === 'abort' ? 1 : 0 });
	}
});

// Independent code-point oracles, including the distinct physical transfer curves.
test('Motion finishing converts each actual transfer and flattens straight alpha once', () => {
	for (const [encoding, cases] of [
		['srgb', [[[128, 128, 128, 255], [115, 128, 128]], [[64, 128, 192, 255], [107, 165, 96]], [[128, 128, 128, 128], [83, 128, 128]]]],
		['rec709', [[[128, 128, 128, 255], [126, 128, 128]], [[64, 128, 192, 255], [118, 163, 97]], [[128, 128, 128, 128], [91, 128, 128]]]],
	] as const) {
		for (const [rgba, expected] of [...cases, [[255, 0, 0, 128], [49, 110, 207]], [[255, 100, 90, 0], [16, 128, 128]]] as const) {
			const target = new Uint8Array(3);
			assert.equal(videoRgbaI420Pixels(Uint8Array.from(rgba), 1, 1, { ...output, encoding }, target), target);
			assert.deepEqual([...target], expected);
		}
	}
	assert.deepEqual([...videoRgbaI420Pixels(Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255), 3, 1, output)], [63, 173, 32, 72, 240, 133, 118]);
	assert.equal(videoI420ByteLength(8192, 4320), 53084160, 'existing Frame canvases do not acquire the Motion working-surface ceiling');
});

test('Motion finishing snapshots only closed data color contracts and refuses malformed buffers', () => {
	assert.deepEqual(normalizeVideoRgbaOutput(undefined), { encoding: 'srgb', alphaMode: 'straight', precision: 'unorm8' });
	const mutable = { ...output }; const snapshot = normalizeVideoRgbaOutput(mutable);
	Object.assign(mutable, { encoding: 'srgb' }); assert.equal(snapshot.encoding, 'rec709'); assert.ok(Object.isFrozen(snapshot));
	let getterReads = 0;
	for (const value of [null, {}, { ...output, encoding: 'p3' }, { ...output, alphaMode: 'premultiplied' }, { ...output, extra: true }, Object.create(output),
		{ ...output, get encoding() { getterReads++; return 'rec709'; } }]) assert.throws(() => normalizeVideoRgbaOutput(value), /RGBA|contract/u);
	assert.equal(getterReads, 0);
	assert.throws(() => videoRgbaI420Pixels(new Uint8Array(3), 1, 1, output), /bytes/u);
	assert.throws(() => videoRgbaI420Pixels(new Uint8Array(4), 1, 1, output, new Uint8Array(4)), /target/u);
	for (const size of [0, -1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER]) assert.throws(() => videoI420ByteLength(size, 2), /dimensions/u);
});

test('Motion uses an explicit sRGB legacy contract and refuses an invalid contract before producing frames', async () => {
	const h = harness([128, 128, 128, 255]); await produceVideoWebCodecsChunks(h.request);
	assert.deepEqual([...h.frames[0]!.bytes], [115, 115, 115, 128, 128, 128, 128]);
	const invalid = harness([0, 0, 0, 0]);
	await assert.rejects(produceVideoWebCodecsChunks({ ...invalid.request, rgbaOutput: { ...output, alphaMode: 'premultiplied' } as never }), /contract/u);
	assert.equal(invalid.frames.length, 0); assert.equal(invalid.counts().writes, 0);
});


test('Motion finishing contract survives common admission and actual browser execution into encoder planes', async () => {
	for (const encoding of ['srgb', 'rec709'] as const) {
		const h = harness([128, 128, 128, 255]); let disposed = 0, chunks = 0;
		const frameSource = createVideoExactPictureExportFrameSource({ sampleRate: 48000, startFrame: 0, endFrame: 3200,
			canvas: { width: 4, height: 2, frameRate: { num: 30, den: 1 } } });
		const result = await encodeVideoKeyframeVideo(null, {
			frameSource, format: 'mp4', rgbaOutput: { ...output, encoding },
			producer: { ...h.request.producer, byteLength: 32, width: 4, height: 2, dispose() { disposed++; } },
			webCodecs: { codec: h.request.codec, bitrate: h.request.bitrate, encoderClass: h.request.encoderClass, videoFrameClass: h.request.videoFrameClass },
		}, {
			createJobToken: () => '0123456789abcdef0123456789abcdef',
			executeBrowserWebCodecs: request => executeVideoKeyframeMediabunnyEncoder(request, {
				produceVideo: produceVideoWebCodecsChunks,
				createMuxer: () => ({
					async start() {}, async addVideoChunk() { chunks++; }, async addAudioPcm() { throw new Error('No audio'); },
					async finalize() { return { bytes: structuralMp4.slice(), videoChunkCount: chunks, videoByteLength: chunks, audioChunkCount: 0, audioFrameCount: 0, decoderConfigObserved: true }; },
					async cancel() { throw new Error('Unexpected cancellation'); },
				}),
			}),
		});
		assert.equal(result.frameCount, 2); assert.equal(disposed, 1); assert.equal(chunks, 2);
		assert.deepEqual([...h.frames[0]!.bytes], [...Array<number>(8).fill(encoding === 'srgb' ? 115 : 126), 128, 128, 128, 128]);
		assert.deepEqual(h.frames[0]!.init.colorSpace, colorSpace);
	}
});


test('Motion finishing picture-only export forwards the exact midtone output transfer', async () => {
	const options = framescaperV20Options() as Record<string, unknown>;
	const clips = options.clips as Record<string, unknown>[];
	const tracks = options.tracks as Record<string, unknown>[];
	const project = createFramescaperProjectFinishing(finishingProfile, {
		...options, videoTransitionsByTrackId: { 'video-track': [] },
		clips: [...clips.filter(clip => clip.id !== 'video-clip'), { schemaVersion: 1, kind: 'generator', id: 'gray-clip', sourceId: 'gray', sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10 }],
		tracks: tracks.map(track => track.id === 'video-track' ? { ...track, clipIds: ['gray-clip'] } : track),
		visualModel: { stillSources: [], adjustmentLayers: [], presets: [], maskMattes: [], freezeFallbacks: [], generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'gray', name: 'Gray', width: 4, height: 2, frameRate: { num: 10, den: 1 }, frameCount: 100, generator: { kind: 'solid', color: '#808080ff' } }] },
	} as never);
	let seen = false;
	const strategy = createFramescaperVideoExportStrategyFinishing(finishingProfile, {
		async encodeOffline() { throw new Error('Unexpected keyed picture'); },
		async encodeOfflineToSink() { throw new Error('Unexpected keyed sink'); },
		async encodePicture(_engine, request) {
			assert.deepEqual(request.rgbaOutput, output);
			const rgba = new Uint8Array(request.producer.byteLength);
			await request.producer.produce(request.frameSource.frame(0), rgba, { signal: request.signal! });
			assert.deepEqual([...rgba.subarray(0, 4)], [115, 115, 115, 255]);
			assert.equal(videoRgbaI420Pixels(rgba, 4, 2, request.rgbaOutput!)[0], 115);
			seen = true;
			return { bytes: Uint8Array.of(1), byteLength: 1, videoEncoder: 'webcodecs', format: 'mp4', extension: '.mp4', mimeType: 'video/mp4', frameCount: request.frameSource.frameCount, rgbaChunkCount: request.frameSource.frameCount, outputChunkCount: 1 };
		},
	});
	const canonicalProject = project as Readonly<Record<string, unknown>>;
	const exportProject = strategy.createExportProject({ canonicalProject, delivery: { project: {}, audioRenderedFallback: null, videoRenderedFallback: null, requiredAudioSourceIds: [], requiredVideoSourceIds: [] } });
	const plan = strategy.createPlan({ canonicalProject, exportProject, format: 'mp4', range: 'project', includeAudio: false, canvas: { width: 4, height: 2, frameRate: { num: 10, den: 1 } } }); assert.ok(plan);
	const sources = project.sources as readonly { kind: string; id: string; frameRate: { num: number; den: number }; sourceFrameCount: number }[];
	const timingViewsBySourceId = new Map(sources.filter(source => source.kind === 'video').map(source => [source.id, { kind: 'cfr' as const, rate: source.frameRate, frameCount: source.sourceFrameCount }]));
	await strategy.encode({ canonicalProject, exportProject, plan, timingViewsBySourceId, timingBySourceId: new Map(), videoBlobs: new Map(), audioMix: null, editorFfmpeg: {}, webCodecs: null, signal: new AbortController().signal, assertCurrent() {}, maximumOutputBytes: undefined });
	assert.equal(seen, true);
});


test('Motion raw-stream admission refuses malformed transfer before any stream and disposes the producer', async () => {
	let streams = 0, disposed = 0;
	const h = harness([128, 128, 128, 255]);
	const frameSource = createVideoExactPictureExportFrameSource({ sampleRate: 48000, startFrame: 0, endFrame: 1600,
		canvas: { width: 4, height: 2, frameRate: { num: 30, den: 1 } } });
	await assert.rejects(encodeVideoKeyframeFrames({
		frameSource, format: 'mp4', inputPath: '/picture.rgba', outputPath: '/picture.mp4',
		rgbaOutput: { ...output, encoding: 'wrong' } as never,
		producer: { ...h.request.producer, byteLength: 32, width: 4, height: 2, dispose() { disposed++; } },
		ffmpeg: {
			createInputStream() { streams++; throw new Error('No stream should be acquired'); },
			exec() { throw new Error('No execution should start'); }, terminateExecution() {},
		},
	}), /RGBA output contract/u);
	assert.equal(streams, 0); assert.equal(disposed, 1);
});
