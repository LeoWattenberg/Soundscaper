/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { evaluateVideoMaskMatteRgbaV13 } from '../src/common/editor/video-mask-matte-rgba-v13.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { framescaperProjectVisualFoundationFinishing } from '../src/framescaper/editor-project-finishing-validation.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV16 } from '../src/framescaper/editor-project-unified-render-plan-v16.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsFinishing } from '../src/framescaper/editor-project-unified-render-timing-finishing.ts';
import { createFramescaperSelectedExactFrameExecutionV16 } from '../src/framescaper/selected-finishing-exact-frame-execution-v16.ts';
import { combinedGraphs } from '../src/framescaper/selected-finishing-exact-frame-support.ts';
import { selectedFinishingCompositionRangeMaskV1 } from '../src/framescaper/selected-finishing-luminance-mask-frame-v1.ts';
import { visualFreshness } from './helpers/framescaper-unified-render-project-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const RATE = { num: 10, den: 1 } as const;
const SOURCE = [128, 128, 128, 255, 255, 0, 0, 128, 128, 128, 128, 255, 255, 0, 0, 128];
function range(lower = 0.21, upper = 0.22, falloff = 0) {
	return { schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [],
		nodes: [{ id: 'range', kind: 'luminance-range', lower, upper, falloff }], outputNodeId: 'range' };
}
function context(options: Readonly<{ kind?: 'media' | 'visual' | 'adjustment'; grade?: boolean; lower?: number; upper?: number; width?: number }> = {}) {
	const kind = options.kind ?? 'media', width = options.width ?? 4;
	const grade = options.grade ? { schemaVersion: 1, exposureStops: 1, contrast: 1, pivot: 0.18,
		lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1, lut: null } : null;
	const owner = kind === 'adjustment' ? { kind: 'adjustment-layer', id: 'adjustment' }
		: kind === 'visual' ? { kind: 'generator', id: 'generator' } : { kind: 'clip', id: 'clip' };
	const project = createFramescaperProjectFinishing(PROFILE, {
		id: 'range-finishing', title: 'Range finishing', now: '2026-10-11T00:00:00.000Z',
		sources: [createVideoSource({ id: 'source', name: 'Pixels', storageKey: 'original', mimeType: 'video/mp4', contentSha256: '12'.repeat(32),
			frameCount: 4800, sampleFrameCount: 4800, sourceFrameCount: 1, frameRate: RATE, width: 2, height: 2 })],
		clips: [{ kind: 'video', id: 'clip', sourceId: 'source', title: 'Pixels', sequenceId: 'main', sequenceStartFrame: 0,
			sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1, retimeMap: null, videoEffects: [] },
			...(kind === 'visual' ? [{ schemaVersion: 1, kind: 'generator', id: 'generator-clip', sourceId: 'generator',
				sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1 }] : [])],
		tracks: [createVideoTrack({ id: 'track', name: 'Video', clipIds: kind === 'visual' ? ['clip', 'generator-clip'] : ['clip'], locked: false })],
		sequences: [{ id: 'main', rate: RATE, trackIds: ['track'] }], primarySequenceId: 'main', videoTransitionsByTrackId: { track: [] },
		visualModel: { stillSources: [], presets: [], freezeFallbacks: [], maskMattes: [range(options.lower, options.upper)],
			generatorSources: kind === 'visual' ? [{ schemaVersion: 1, kind: 'generator', id: 'generator', name: 'Literal gray',
				width: 2, height: 2, frameRate: RATE, frameCount: 1, generator: { kind: 'solid', color: '#80808080' } }] : [],
			adjustmentLayers: kind === 'adjustment' ? [{ schemaVersion: 1, kind: 'adjustment-layer', id: 'adjustment', sequenceId: 'main',
				sequenceStartFrame: 0, sequenceFrameCount: 1, targetTrackIds: ['track'], effectIds: [] }] : [] },
		finishing: { colorContexts: [{ schemaVersion: 1, sequenceId: 'main', workingSpace: 'linear-rec709-d65', outputSpace: 'srgb',
			alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' }],
			visualPresentations: [{ schemaVersion: 1, id: 'presentation', owner, enabled: true, opacity: 1, blendMode: 'normal',
				grade, processorStackId: null, maskMatteIds: ['mask'] }] },
	});
	const timingViews = new Map([['source', { kind: 'cfr' as const, rate: RATE, frameCount: 1 }]]);
	const plan = createFramescaperProjectUnifiedExactRenderPlanV16(PROFILE, project, { sequenceId: 'main', sampleStart: 0, sampleDuration: 4800,
		outputRate: RATE, format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
		codecs: { video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null, pixelFormat: 'yuv420p' },
		canvas: { width, height: 2, fit: 'contain', pixelFormat: 'yuv420p', backgroundColor: '#00000000' }, quality: 'balanced',
		includeAudio: false, audioLayout: null, timingViews,
		visualFreshnessByModelId: visualFreshness(framescaperProjectVisualFoundationFinishing(PROFILE, project)) });
	return { project, plan, timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsFinishing(project, timingViews) };
}
function request(target: Uint8Array<ArrayBuffer>, signal: AbortSignal, visual = false) {
	return { sequencePosition: { num: 0, den: 1 }, outputOrdinal: 0, width: target.length / 8, height: 2, target, signal,
		layers: visual ? [] : [{ trackId: 'track', entries: [{ clipId: 'clip', sourceId: 'source', effects: [],
			presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 }, displayWidth: 2, displayHeight: 2, intervalProgress: 0,
			renderDescription: { crop: { normalized: { left: 0, top: 0, right: 0, bottom: 0 }, sourcePixels: { x: 0, y: 0, width: 2, height: 2 } },
				sourceDisplayToCanvas: [1, 0, 0, 1, 1, 0], opacityStart: 1, opacityEnd: 1, blendMode: 'normal', compositingOrder: 0 } }] }] };
}

test('actual Frame media range samples the placed straight linear picture once and retains partial source alpha', async () => {
	const source = new Uint8Array(SOURCE), before = source.slice(), stop = new AbortController(), target = new Uint8Array(32);
	const execution = await createFramescaperSelectedExactFrameExecutionV16({ ...context(), signal: stop.signal, assertCurrent() {},
		captureFrame: () => ({ width: 2, height: 2, pixels: source }) });
	try {
		const result = await execution.render(request(target, stop.signal));
		// 128 sRGB decodes/rounds to linear55. Its .215686 luma belongs to
		// [.21,.22]; decoding55 a second time would wrongly remove the gray.
		assert.deepEqual([...target], [0, 0, 0, 0, 128, 128, 128, 255, 255, 0, 0, 128, 0, 0, 0, 0,
			0, 0, 0, 0, 128, 128, 128, 255, 255, 0, 0, 128, 0, 0, 0, 0]);
		assert.ok(result.consumedNodeIds.includes('render:visual:mask')); assert.deepEqual(source, before);
	} finally { await execution.dispose(); }
});

test('media range chooses post-finishing membership, while adjustment range chooses the composition before its own grade', async () => {
	const source = new Uint8Array([128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255]);
	for (const [kind, lower, upper] of [['media', 0.4, 0.5], ['adjustment', 0.21, 0.22]] as const) {
		const stop = new AbortController(), target = new Uint8Array(32);
		const execution = await createFramescaperSelectedExactFrameExecutionV16({ ...context({ kind, grade: true, lower, upper }), signal: stop.signal,
			assertCurrent() {}, captureFrame: () => ({ width: 2, height: 2, pixels: source }) });
		try {
			await execution.render(request(target, stop.signal));
			// Linear55 gains one stop to110; its one final sRGB encode is175.
			assert.deepEqual([...target], [0, 0, 0, 0, 175, 175, 175, 255, 175, 175, 175, 255, 0, 0, 0, 0,
				0, 0, 0, 0, 175, 175, 175, 255, 175, 175, 175, 255, 0, 0, 0, 0]);
			assert.deepEqual([...source], Array.from({ length: 4 }, () => [128, 128, 128, 255]).flat());
		} finally { await execution.dispose(); }
	}
});

test('actual generator visual range uses the decoded placed image and keeps its authored partial alpha', async () => {
	const stop = new AbortController(), target = new Uint8Array(16);
	const execution = await createFramescaperSelectedExactFrameExecutionV16({ ...context({ kind: 'visual', width: 2 }), signal: stop.signal,
		assertCurrent() {}, captureFrame() { throw Error('Generator range acquired unrelated media'); } });
	try { await execution.render(request(target, stop.signal, true)); assert.deepEqual([...target], Array.from({ length: 4 }, () => [128, 128, 128, 128]).flat()); }
	finally { await execution.dispose(); }
});

test('actual Frame Close joins held capture cancellation, preserves its opaque reason and clears accepted output', async () => {
	const source = new Uint8Array(SOURCE), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const reason = opaque.proxy;
	const execution = await createFramescaperSelectedExactFrameExecutionV16({ ...context(), signal: stop.signal, assertCurrent() {},
		async captureFrame() { entered.resolve(); await release.promise; return { width: 2, height: 2, pixels: source }; } });
	const target = new Uint8Array(32).fill(99), work = execution.render(request(target, stop.signal));
	const outcome = work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
	let closing: Promise<void> | undefined;
	try {
		await Promise.race([entered.promise, work]); stop.abort(reason); closing = execution.dispose();
		assert.equal(execution.dispose(), closing); assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true);
	} finally { release.resolve(); await outcome; await (closing ?? execution.dispose()); }
	const result = await outcome; assert.equal(result.failed, true); assert.equal(Object.is(result.error, reason), true);
	assert.ok(target.every(byte => byte === 0)); assert.deepEqual([...source], SOURCE);
});

test('legacy dimension-only finishing callers refuse range authority instead of inventing pixels', () => {
	for (const call of [() => evaluateVideoMaskMatteRgbaV13(range(), 2, 1), () => combinedGraphs([range()], 2, 1, new Map())]) {
		assert.throws(call, /current|frame|pixel/iu);
	}
});

test('Frame range working-set admission precedes straight conversion or composition pixel acquisition', () => {
	let reads = 0;
	const hostile = { width: 4096, height: 4096, get pixels(): Float64Array<ArrayBuffer> { reads++; throw Error('Unaffordable composition pixels acquired'); } };
	assert.throws(() => selectedFinishingCompositionRangeMaskV1([range()], hostile,
		new Map(), new AbortController().signal), /budget|working|64 MiB/iu);
	assert.equal(reads, 0);
});
