/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { ProductVideoExportStrategyEncodeRequest } from '../src/common/editor/controller/export/product-video-export-strategy.ts';
import type { FfmpegOutputSink } from '../src/common/editor/ffmpeg-output-stream.ts';
import { encodePixelFramePngV1 } from '../src/common/editor/imaging/pixel-frame-png-v1.ts';
import type { VideoKeyframeVideoEncoderRequest, VideoKeyframeVideoEncoderResult } from '../src/common/editor/video-keyframe-video-encoder.ts';
import type { VideoKeyframeOfflineRgbaPostprocessor } from '../src/common/editor/video-keyframe-offline-rgba-contract.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing, type FramescaperProjectFinishingOptions } from '../src/framescaper/editor-project-finishing.ts';
import { createFramescaperVideoExportStrategyFinishing } from '../src/framescaper/video-export-strategy-finishing.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { deferred, remainsPending, waitFor } from './helpers/async-test-control.ts';

type Kind = 'generator' | 'still';
type Mode = 'buffer' | 'sink';
const WIDTH = 4, HEIGHT = 2;
const MUTATED = [17, 39, 83, 127];
const sink: FfmpegOutputSink<string> = { open: async () => {}, write: async () => {}, close: async () => 'saved', abort: async () => {} };

async function fixture(kind: Kind, mode: Mode, events: string[] = [], staleBody = false) {
	const color = kind === 'generator' ? [255, 0, 0, 255] : [0, 255, 0, 255];
	const expected = Uint8Array.from(Array.from({ length: WIDTH * HEIGHT }, () => color).flat());
	// A genuine small PNG is authenticated by the real store owner. The injected
	// static decoder returns a literal plane; this is not native codec qualification.
	const png = await encodePixelFramePngV1({ descriptor: { schemaVersion: 1, width: WIDTH, height: HEIGHT,
		sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: expected });
	const blob = new Blob([png], { type: 'image/png' }), digest = createHash('sha256').update(png).digest('hex');
	const options = framescaperV20Options();
	options.clips = [{ schemaVersion: 1, kind, id: 'picture-clip', sourceId: 'picture-source', sequenceId: 'main-sequence',
		sequenceStartFrame: 0, sequenceFrameCount: 10, ...(kind === 'generator' ? { sourceInFrame: 0, sourceFrameCount: 10 } : {}) }];
	options.tracks = (options.tracks as Record<string, unknown>[]).map(track => ({ ...track, clipIds: track.id === 'video-track' ? ['picture-clip'] : [] }));
	options.videoTransitionsByTrackId = { 'video-track': [] };
	options.visualModel = { stillSources: kind === 'still' ? [{ schemaVersion: 1, kind, id: 'picture-source', name: 'Plate',
		mimeType: 'image/png', storageKey: 'plate-storage', contentSha256: digest, width: WIDTH, height: HEIGHT, hasAlpha: false }] : [],
		generatorSources: kind === 'generator' ? [{ schemaVersion: 1, kind, id: 'picture-source', name: 'Solid', width: WIDTH,
			height: HEIGHT, frameRate: { num: 10, den: 1 }, frameCount: 100, generator: { kind: 'solid', color: '#ff0000ff' } }] : [],
		adjustmentLayers: [], presets: [], maskMattes: [], freezeFallbacks: [] };
	const project = createFramescaperProjectFinishing(PROFILE, options as FramescaperProjectFinishingOptions);
	const seen: Uint8Array[] = [];
	const produce = async (request: VideoKeyframeVideoEncoderRequest) => {
		const target = new Uint8Array(request.producer.byteLength), frame = request.frameSource.frame(0);
		await request.producer.produce(frame, target, { signal: request.signal! });
		seen.push(target.slice()); events.push('encode');
	};
	const encoded = (): VideoKeyframeVideoEncoderResult => ({ bytes: Uint8Array.of(1, 2, 3), byteLength: 3,
		videoEncoder: 'ffmpeg', codec: 'h264', format: 'mp4', extension: '.mp4', mimeType: 'video/mp4',
		frameCount: 1, rgbaChunkCount: 1, outputChunkCount: 1 });
	const strategy = createFramescaperVideoExportStrategyFinishing(PROFILE, {
		encodeOffline: async () => encoded(), encodeOfflineToSink: async () => { throw new Error('Unexpected keyed route.'); },
		encodePicture: async (_owner, request) => { await produce(request); return encoded(); },
		encodePictureToSink: async (_owner, request, destination) => {
			await produce(request); await destination.open(3); await destination.write(Uint8Array.of(1, 2, 3));
			const output = await destination.close(); const { bytes: _bytes, ...identity } = encoded(); return { ...identity, output };
		},
	}, {
		loadMediaAsset: async key => { assert.equal(key, 'plate-storage'); events.push('load'); return staleBody ? new Blob(['different']) : blob; },
		decodeStillAsset: async ({ blob: actual, signal }) => {
			signal.throwIfAborted(); assert.deepEqual(new Uint8Array(await actual.arrayBuffer()), png); events.push('decode');
			return { width: WIDTH, height: HEIGHT, pixels: expected.slice() };
		},
	}, undefined, () => ({ resolve: () => [], dispose: () => { events.push('dispose'); } }));
	const exportProject = strategy.createExportProject({ canonicalProject: project as unknown as Record<string, unknown>, delivery: {
		project: {}, audioRenderedFallback: null, videoRenderedFallback: null, requiredAudioSourceIds: [], requiredVideoSourceIds: [],
	} });
	const plan = strategy.createPlan({ canonicalProject: project as unknown as Record<string, unknown>, exportProject,
		format: 'mp4', range: 'project', includeAudio: false, canvas: undefined })!;
	const run = (postprocess?: VideoKeyframeOfflineRgbaPostprocessor, signal = new AbortController().signal) => {
		const request: ProductVideoExportStrategyEncodeRequest = { canonicalProject: project as unknown as Record<string, unknown>, exportProject, plan,
			timingBySourceId: new Map(), timingViewsBySourceId: new Map([['video-source', { kind: 'cfr', rate: { num: 10, den: 1 }, frameCount: 10 }]]),
			videoBlobs: new Map(), audioMix: null, editorFfmpeg: {}, webCodecs: null, signal,
			assertCurrent: () => {}, maximumOutputBytes: undefined, ...(postprocess ? { rgbaPostprocessor: postprocess } : {}) };
		return mode === 'buffer' ? strategy.encode(request) : strategy.encodeToSink(request, sink);
	};
	return { run, expected, seen, events };
}

for (const kind of ['generator', 'still'] as const) for (const mode of ['buffer', 'sink'] as const) {
	test(`${kind} ${mode} export applies postprocessing to the real composed plane before encoding`, async () => {
		const built = await fixture(kind, mode), signal = new AbortController().signal;
		await built.run(request => {
			assert.equal(request.width, WIDTH); assert.equal(request.height, HEIGHT); assert.equal(request.signal, signal);
			assert.equal(request.frame.index, 0); assert.ok(Object.isFrozen(request));
			assert.deepEqual(request.rgba, built.expected); built.events.push('postprocess'); request.rgba.set(MUTATED);
		}, signal);
		const expected = built.expected.slice(); expected.set(MUTATED);
		assert.deepEqual(built.seen, [expected]); assert.deepEqual(built.events.slice(-3), ['postprocess', 'encode', 'dispose']);
		if (kind === 'still') assert.deepEqual(built.events.slice(0, 2), ['load', 'decode']);
	});
}

for (const kind of ['generator', 'still'] as const) {
	const mode = kind === 'generator' ? 'buffer' : 'sink';
	test(`${kind} export leaves exact composed bytes unchanged when no callback is supplied`, async () => {
		const built = await fixture(kind, mode); await built.run();
		assert.deepEqual(built.seen, [built.expected]); assert.equal(built.events.filter(event => event === 'dispose').length, 1);
	});
	test(`${kind} export joins a held postprocessor before encoding or disposing`, async () => {
		const built = await fixture(kind, mode), release = deferred<void>();
		const pending = built.run(async ({ rgba }) => { built.events.push('postprocess'); await release.promise; rgba.set(MUTATED); });
		void pending.then(() => built.events.push('settled'), () => built.events.push('settled'));
		try {
			await waitFor(() => built.events.includes('postprocess') || built.events.includes('settled'), 'postprocessor or export settlement');
			assert.ok(built.events.includes('postprocess')); assert.equal(await remainsPending(pending), true);
			assert.equal(built.events.includes('encode'), false); assert.equal(built.events.includes('dispose'), false);
		} finally { release.resolve(); }
		await pending; assert.deepEqual(built.events.slice(-3), ['encode', 'dispose', 'settled']);
	});
	test(`${kind} opaque postprocessor failure is retained through exact disposal`, async () => {
		const built = await fixture(kind, mode), reason = Symbol('postprocessor failure');
		await assert.rejects(built.run(() => { built.events.push('postprocess'); throw reason; }), error => Object.is(error, reason));
		assert.equal(built.seen.length, 0); assert.deepEqual(built.events.slice(-2), ['postprocess', 'dispose']);
	});
	test(`${kind} cancellation joins the held callback then disposes without encoding`, async () => {
		const built = await fixture(kind, mode), release = deferred<void>(), stop = new AbortController(), reason = Symbol('held cancellation');
		const pending = built.run(async () => { built.events.push('postprocess'); await release.promise; }, stop.signal);
		void pending.then(() => built.events.push('settled'), () => built.events.push('settled'));
		try {
			await waitFor(() => built.events.includes('postprocess') || built.events.includes('settled'), 'postprocessor or export settlement');
			assert.ok(built.events.includes('postprocess')); stop.abort(reason);
			assert.equal(await remainsPending(pending), true); assert.equal(built.events.includes('dispose'), false);
		} finally { release.resolve(); }
		await assert.rejects(pending, error => Object.is(error, reason));
		assert.equal(built.events.includes('encode'), false); assert.deepEqual(built.events.slice(-2), ['dispose', 'settled']);
	});
}

test('an unauthenticated still refuses before decode, composition or postprocessing', async () => {
	const built = await fixture('still', 'buffer', [], true);
	await assert.rejects(built.run(() => assert.fail('unauthenticated callback')), /missing or stale/u);
	assert.deepEqual(built.events, ['load']); assert.equal(built.seen.length, 0);
});
