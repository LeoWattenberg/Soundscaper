/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoSource, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV16 } from '../src/framescaper/editor-project-unified-render-plan-v16.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsFinishing } from '../src/framescaper/editor-project-unified-render-timing-finishing.ts';
import { createFramescaperSelectedExactPreviewV16 } from '../src/framescaper/editor-selected-finishing-exact-preview-v16.ts';
import { createFramescaperSelectedVisualPreviewSessionFinishing } from '../src/framescaper/editor-selected-finishing-visual-preview.ts';
import { shouldRenderExactProductVideoPreview } from '../src/common/editor/ui/workspace/video-preview-exact-render-policy.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { liveFixture } from './helpers/framescaper-native-live-openfx-fixture.ts';
import { cloneFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as NATIVE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from '../src/framescaper/editor-project-native-media-foundation.ts';
import { createFramescaperOpenFxExecutionForResourceFoundationV16 } from '../src/framescaper/selected-native-media-openfx-resource-v16.ts';
import { createFramescaperVideoExportVisualFreshnessFinishing } from '../src/framescaper/video-export-visual-freshness-finishing.ts';
import { createFramescaperSelectedExactFrameExecutionV16 } from '../src/framescaper/selected-finishing-exact-frame-execution-v16.ts';
import type { SelectedExactFrameExecutionOptions } from '../src/framescaper/selected-finishing-exact-frame-contract.ts';
import type { UnifiedExactRenderPlanV16 } from '../src/common/editor/unified-exact-render-plan-v16.ts';

const TEXT = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
const parsed = parseCubeLutV1(TEXT), body = new TextEncoder().encode(TEXT);
const reference = { storageKey: `lut-sha256:${parsed.sha256}`, sha256: parsed.sha256, byteLength: parsed.byteLength,
	size: parsed.size, domainMin: parsed.domainMin, domainMax: parsed.domainMax };
const effect = { id: 'cube', type: 'cube-lut-profile-v1', enabled: true, params: { lut: reference } };
const sourceBytes = [255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255];
const expected = [0,0,255,255,0,255,0,255,255,0,0,255,255,255,255,255];
const rate = { num: 10, den: 1 };
function context(legacyGrade = false, adjustment = false) {
	const project = createFramescaperProjectFinishing(PROFILE, { id: 'preview', title: 'Preview', now: '2026-10-09T00:00:00.000Z',
		sources: [createVideoSource({ id: 'source', name: 'Pixels', storageKey: 'original', mimeType: 'video/mp4', contentSha256: '12'.repeat(32),
			frameCount: 4800, sampleFrameCount: 4800, sourceFrameCount: 1, frameRate: rate, width: 2, height: 2 })],
		clips: [{ kind: 'video', id: 'clip', sourceId: 'source', title: 'Pixels', sequenceId: 'main', sequenceStartFrame: 0,
			sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1, retimeMap: null, videoEffects: legacyGrade ? [] : [effect] }],
		tracks: [createVideoTrack({ id: 'track', name: 'Video', clipIds: ['clip'], locked: false })],
		sequences: [{ id: 'main', rate, trackIds: ['track'] }], primarySequenceId: 'main',
		...(adjustment ? { visualModel: { stillSources: [], generatorSources: [], presets: [], maskMattes: [], freezeFallbacks: [],
			adjustmentLayers: [{ schemaVersion: 1, kind: 'adjustment-layer', id: 'adjustment', sequenceId: 'main',
				sequenceStartFrame: 0, sequenceFrameCount: 1, targetTrackIds: ['track'], effectIds: ['cube'] }] } } : {}),
		finishing: { ...(legacyGrade ? { visualPresentations: [{ schemaVersion: 1, id: 'grade', owner: { kind: 'clip', id: 'clip' },
			enabled: true, opacity: 1, blendMode: 'normal', processorStackId: null, maskMatteIds: [],
			grade: { schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: .18, lift: [0,0,0], gamma: [1,1,1], gain: [1,1,1], saturation: 1, lut: reference } }] } : {}),
			colorContexts: [{ schemaVersion: 1, sequenceId: 'main', workingSpace: 'linear-rec709-d65', outputSpace: 'srgb',
			alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' }] } });
	const timingViews = new Map([['source', { kind: 'cfr' as const, rate, frameCount: 1 }]]);
	const plan = createFramescaperProjectUnifiedExactRenderPlanV16(PROFILE, project, { sequenceId: 'main', sampleStart: 0, sampleDuration: 4800,
		outputRate: rate, format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
		codecs: { video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null, pixelFormat: 'yuv420p' },
		canvas: { width: 2, height: 2, fit: 'contain', pixelFormat: 'yuv420p', backgroundColor: '#00000000' }, quality: 'balanced',
		includeAudio: false, audioLayout: null, timingViews,
		visualFreshnessByModelId: adjustment ? createFramescaperVideoExportVisualFreshnessFinishing(project, { startFrame: 0, durationFrames: 4800 }) : new Map() });
	return { profile: PROFILE, project, plan, timingViews, boundTimingViews: bindFramescaperUnifiedRenderTimingSidecarsFinishing(project, timingViews) };
}
function request(signal: AbortSignal) {
	return { timelineSample: 0, signal, mediaLayers: [{ trackId: 'track', entries: [{ clipId: 'clip', sourceId: 'source',
		displayWidth: 2, displayHeight: 2, effects: [effect], intervalProgress: 0,
		renderDescription: { crop: { normalized: { left: 0, top: 0, right: 0, bottom: 0 }, sourcePixels: { x: 0, y: 0, width: 2, height: 2 } },
			sourceDisplayToCanvas: [1,0,0,1,0,0], opacityStart: 1, opacityEnd: 1, blendMode: 'normal', compositingOrder: 0 } }] }],
		frame: { layers: [], adjustments: [], activeFreezeNodeIds: [], availablePresetIds: [],
			ledger: { requestedNodeIds: [], consumedNodeIds: [], omittedNodeIds: [] } } };
}

test('named16 exact preview publishes the V27 literal and retires its private target after the output takes ownership', async () => {
	let retained: Uint8Array | undefined, disposed = 0; const written: number[][] = [], stop = new AbortController();
	const source = new Uint8Array(sourceBytes), before = source.slice();
	const preview = await createFramescaperSelectedExactPreviewV16({ ...context(), signal: stop.signal, assertCurrent() {},
		captureFrame() { return { width: 2, height: 2, pixels: source }; }, store: { async loadMediaAsset() { return new Blob([body]); } } as never,
		createOutput() { return { drawable: {}, write(pixels) { retained = pixels; written.push(Array.from(pixels)); }, dispose() { disposed++; } }; } });
	await preview.render(request(stop.signal));
	assert.deepEqual(written, [expected]); assert.ok(retained!.every(value => value === 0)); assert.deepEqual(source, before);
	const closing = preview.close(); assert.equal(preview.close(), closing); await closing; assert.equal(disposed, 1);
});

test('named16 close seals and joins a held native body before clearing output, preserving caller cancellation identity', async () => {
	const held = deferred<void>(), entered = deferred<void>(), stop = new AbortController(); let joined = false, disposed = 0, writes = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); },
		getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const preview = await createFramescaperSelectedExactPreviewV16({ ...context(), signal: new AbortController().signal, assertCurrent() {},
		captureFrame() { return { width: 2, height: 2, pixels: new Uint8Array(sourceBytes) }; },
		store: { async loadMediaAsset() { entered.resolve(); await held.promise; joined = true; return new Blob([body]); } } as never,
		createOutput() { return { drawable: {}, write() { writes++; }, dispose() { disposed++; } }; } });
	const work = preview.render(request(stop.signal)), outcome = work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	await entered.promise; stop.abort(reason); const closing = preview.close(); void closing.catch(() => undefined);
	try {
		assert.equal(preview.close(), closing); assert.equal(await remainsPending(closing), true); assert.equal(disposed, 0);
		await assert.rejects(preview.render(request(new AbortController().signal)), /disposed|retired/iu);
		held.resolve(); assert.equal((await outcome).error, reason); await closing;
		assert.equal(joined, true); assert.equal(disposed, 1); assert.equal(writes, 0); assert.equal(traps, 0);
	} finally { held.resolve(); await outcome; await closing.catch(() => undefined); }
});

test('named16 retirement retains opaque owned-output cleanup failure and one close promise', async () => {
	const cleanup = Object.freeze({ cleanup: true }), stop = new AbortController(); let calls = 0;
	const preview = await createFramescaperSelectedExactPreviewV16({ ...context(), signal: stop.signal, assertCurrent() {},
		store: { async loadMediaAsset() { return new Blob([body]); } } as never,
		createOutput() { return { drawable: {}, write() {}, dispose() { calls++; throw cleanup; } }; } });
	const closing = preview.close(), outcome = closing.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	assert.equal(preview.close(), closing); assert.equal((await outcome).error, cleanup); assert.equal(calls, 1);
});

test('named16 default adjustment output retires before opaque post-effect failure releases the frame join', async () => {
	const NativeBytes = Uint8Array, owned: Uint8Array[] = [], source = new NativeBytes(sourceBytes), before = source.slice(); let traps = 0, writes = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('opaque'); }, getPrototypeOf() { traps++; throw Error('opaque'); }, getOwnPropertyDescriptor() { traps++; throw Error('opaque'); } });
	const preview = await createFramescaperSelectedExactPreviewV16({ ...context(false, true), signal: new AbortController().signal,
		assertCurrent() { if (owned.length > 0) throw reason; }, captureFrame() { return { width: 2, height: 2, pixels: source }; },
		store: { async loadMediaAsset() { return new Blob([body]); } } as never,
		createOutput() { return { drawable: {}, write() { writes++; }, dispose() {} }; } });
	globalThis.Uint8Array = new Proxy(NativeBytes, { construct(target, args, receiver) {
		const value = Reflect.construct(target, args, receiver) as Uint8Array<ArrayBuffer>;
		if (args[0] instanceof NativeBytes && value.length === expected.length && value.every((byte, index) => byte === expected[index])) owned.push(value);
		return value;
	} });
	try {
		const result = await preview.render(request(new AbortController().signal)).then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
		assert.equal(result.error, reason); assert.ok(owned.length > 0); assert.ok(owned.every(bytes => bytes.every(byte => byte === 0)));
		assert.equal(writes, 0); assert.deepEqual(source, before); assert.equal(traps, 0);
	} finally { globalThis.Uint8Array = NativeBytes; await preview.close(); }
});

for (const adjustment of [false, true]) test(`named16 captures default ${adjustment ? 'adjustment' : 'media'} output ownership before held LUT demand`, async () => {
	const value = context(false, adjustment), held = deferred<void>(), entered = deferred<void>();
	const NativeBytes = Uint8Array, owned: Uint8Array[] = [], source = new NativeBytes(sourceBytes), before = source.slice(); let traps = 0, replacements = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('opaque'); }, getPrototypeOf() { traps++; throw Error('opaque'); }, getOwnPropertyDescriptor() { traps++; throw Error('opaque'); } });
	const options: { -readonly [Key in keyof SelectedExactFrameExecutionOptions<UnifiedExactRenderPlanV16>]: SelectedExactFrameExecutionOptions<UnifiedExactRenderPlanV16>[Key] } = {
		project: value.project, plan: value.plan, timingSidecars: value.boundTimingViews, signal: new AbortController().signal,
		assertCurrent() { if (owned.length > 0) throw reason; }, captureFrame() { return { width: 2, height: 2, pixels: source }; },
		store: { async loadMediaAsset() { entered.resolve(); await held.promise; return new Blob([body]); } },
	};
	const execution = await createFramescaperSelectedExactFrameExecutionV16(options);
	globalThis.Uint8Array = new Proxy(NativeBytes, { construct(target, args, receiver) {
		const bytes = Reflect.construct(target, args, receiver) as Uint8Array<ArrayBuffer>;
		if (args[0] instanceof NativeBytes && bytes.length === expected.length && bytes.every((byte, index) => byte === expected[index])) owned.push(bytes);
		return bytes;
	} });
	try {
		const layers = request(options.signal).mediaLayers.map(layer => ({ ...layer, entries: layer.entries.map(entry => ({
			...entry, presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 },
		})) }));
		const task = execution.render({ sequencePosition: { num: 0, den: 1 }, layers,
			width: 2, height: 2, target: new NativeBytes(16), signal: options.signal })
			.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
		await Promise.race([entered.promise, task.then(result => { assert.equal(result.error, undefined); assert.fail('Frame settled before its held default body demand.'); })]);
		options.applyEffects = frame => { replacements++; return Promise.resolve(frame); }; held.resolve();
		assert.equal((await task).error, reason); assert.equal(replacements, 0); assert.ok(owned.length > 0);
		assert.ok(owned.every(bytes => bytes.every(byte => byte === 0))); assert.deepEqual(source, before); assert.equal(traps, 0);
	} finally { held.resolve(); globalThis.Uint8Array = NativeBytes; await execution.dispose(); }
});

test('named16 creation joins owned output disposal when the initial drawable projection throws', async () => {
	let traps = 0; const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); },
		getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	for (const cleanup of [undefined, Object.freeze({ cleanup: true })]) {
		let disposals = 0;
		const work = createFramescaperSelectedExactPreviewV16({ ...context(), signal: new AbortController().signal, assertCurrent() {}, store: {} as never,
			createOutput() { return { get drawable() { throw reason; }, write() {}, dispose() { disposals++; if (cleanup) throw cleanup; } }; } });
		const { error } = await work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
		if (cleanup) { assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [reason, cleanup]); }
		else assert.equal(error, reason);
		assert.equal(disposals, 1); assert.equal(traps, 0);
	}
});

test('named16 write-time retirement rejects the undelivered frame and wipes its target with exact opaque cancellation', async () => {
	const stop = new AbortController(); let retained: Uint8Array | undefined, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); },
		getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const preview = await createFramescaperSelectedExactPreviewV16({ ...context(), signal: stop.signal, assertCurrent() {},
		captureFrame() { return { width: 2, height: 2, pixels: new Uint8Array(sourceBytes) }; },
		store: { async loadMediaAsset() { return new Blob([body]); } } as never,
		createOutput() { return { drawable: {}, write(pixels) { retained = pixels; stop.abort(reason); }, dispose() {} }; } });
	try {
		const { error } = await preview.render(request(stop.signal)).then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
		assert.equal(error, reason); assert.ok(retained!.every(value => value === 0)); assert.equal(traps, 0);
	} finally { await preview.close(); }
});

for (const legacyGrade of [false, true]) test(`the actual current session opts ${legacyGrade ? 'old GradeV27 LUTs' : 'cube profiles'} into exact playing pixels`, async () => {
	const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document'), imageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ImageData');
	const written: number[][] = [];
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() {
		return { width: 2, height: 2, getContext() { return { drawImage() {}, clearRect() {},
			getImageData() { return { data: new Uint8ClampedArray(sourceBytes) }; },
			putImageData(image: { data: Uint8ClampedArray }) { written.push(Array.from(image.data)); } }; } };
	} } });
	Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: class { constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {} } });
	try {
		const input = context(legacyGrade);
		const session = await createFramescaperSelectedVisualPreviewSessionFinishing({ profile: PROFILE, project: input.project, width: 2, height: 2,
			store: { async loadMediaAsset() { return new Blob([body]); } } as never });
		assert.ok(session); assert.equal(shouldRenderExactProductVideoPreview(session, 'playing'), true);
		const frame = request(new AbortController().signal);
		if (legacyGrade) frame.mediaLayers[0]!.entries[0]!.effects = [];
		Object.assign(frame.mediaLayers[0]!.entries[0]!, { video: { drawable: {}, videoWidth: 2, videoHeight: 2, readyState: 4 } });
		await session.renderExact!(frame); assert.deepEqual(written.at(-1), expected); await session.close!();
	} finally {
		if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor); else Reflect.deleteProperty(globalThis, 'document');
		if (imageDescriptor) Object.defineProperty(globalThis, 'ImageData', imageDescriptor); else Reflect.deleteProperty(globalThis, 'ImageData');
	}
});

test('actual current playing Session composes the CPU cube resource with its named OpenFX companion', async t => {
	const descriptors = ['document', 'ImageData'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
	const written: number[][] = []; let pluginCalls = 0;
	Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement() {
		return { width: 2, height: 2, getContext() { return { drawImage() {}, clearRect() {},
			getImageData() { return { data: new Uint8ClampedArray(sourceBytes) }; },
			putImageData(image: { data: Uint8ClampedArray }) { written.push(Array.from(image.data)); } }; } };
	} } });
	Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: class {
		constructor(readonly data: Uint8ClampedArray, readonly width: number, readonly height: number) {}
	} });
	t.after(() => { for (const [key, descriptor] of descriptors) {
		if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
	} });
	const original = liveFixture(true).project, clips = original.clips as readonly Readonly<Record<string, unknown>>[];
	const native = cloneFramescaperProjectNativeMedia(NATIVE, { ...original,
		clips: clips.map(clip => clip.id === 'video-clip' ? { ...clip, videoEffects: [effect] } : clip) });
	const project = framescaperProjectFinishingFoundationShapeNativeMedia(native);
	const session = await createFramescaperSelectedVisualPreviewSessionFinishing({ profile: PROFILE, project, width: 2, height: 2,
		store: { async loadMediaAsset() { return new Blob([body]); } } as never,
		createOpenFxExecutionV16({ foundationPlan, timingViews }) {
			return createFramescaperOpenFxExecutionForResourceFoundationV16({ profile: NATIVE, project: native,
				foundationPlan, timingViews, async execute(plugin) {
					pluginCalls++; assert.equal(plugin.plan.version, 14); assert.deepEqual(Array.from(plugin.inputs[0]!.rgba.pixels), expected);
					const input = plugin.inputs[0]!.rgba.pixels, pixels = new Uint8Array(input.length);
					for (let index = 0; index < pixels.length; index += 4) pixels.set([input[index+1]!, input[index+2]!, input[index]!, input[index+3]!], index);
					return { mode: 'render', rgba: { width: 2, height: 2, pixels }, backend: 'cpu', retriedOnCpu: false, reportsDegradation: false };
				} });
		} });
	assert.ok(session); assert.equal(shouldRenderExactProductVideoPreview(session, 'playing'), true);
	try {
		const frame = request(new AbortController().signal), entry = frame.mediaLayers[0]!.entries[0]!;
		frame.mediaLayers[0]!.trackId = 'video-track'; entry.clipId = 'video-clip'; entry.sourceId = 'video-source';
		Object.assign(entry, { video: { drawable: {}, videoWidth: 2, videoHeight: 2, readyState: 4 } });
		await session.renderExact!(frame);
		assert.equal(pluginCalls, 1); assert.deepEqual(written, [[0,255,0,255,255,0,0,255,0,0,255,255,255,255,255,255]]);
	} finally { await session.close!(); }
});
