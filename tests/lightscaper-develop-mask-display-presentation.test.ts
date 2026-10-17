/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PhotoLibraryDevelopPresentationV2, preparePhotoDevelopPresentationViewV2,
	type PhotoDevelopPresentationViewV2 } from '../src/common/editor/controller/shared/photo-library-develop-presentation-v2.ts';
import type { PhotoLibraryDevelopProxyRuntimeV2 } from '../src/common/editor/photo-library-develop-proxy-port-v2.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { MaskRasterSourcePortV1 } from '../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { normalizeImageDevelopStateV1OrV2, defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { manageImageDevelopMasksV3 } from '../src/common/editor/imaging/image-develop-mask-management-v3.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { createPhotoDevelopRenderRuntimeV2 } from '../src/lightscaper/photo-develop-render-runtime-v2.ts';
import { preparePhotoDevelopMaskDisplayModeV1, preparePhotoDevelopMaskDisplaySelectionV1 } from '../src/common/editor/photo-develop-mask-display-v1.ts';
import { rgbaFrame } from './helpers/lightscaper-masked-frame-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type DisplayView = PhotoDevelopPresentationViewV2 & { readonly maskOverlayMode?: 'color' | 'grayscale' };
const ORIGINAL = [0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 128, 128, 128, 255];
const RANGE_COVERAGE = [223, 0, 184, 215];
// Independent exposure-1 endpoints are primary188 and gray92, blended in linear sRGB.
const RANGE_AFTER = [198, 0, 0, 255, 0, 255, 0, 255, 0, 0, 210, 255, 99, 99, 99, 255];
const grayscale = (coverage: readonly number[]) => coverage.flatMap(value => [value, value, value, 255]);
const color = (coverage: readonly number[]) => coverage.flatMap(value => [255, 48, 48, value]);
const targets = () => ({ before: {} as HTMLCanvasElement, after: {} as HTMLCanvasElement, overlay: {} as HTMLCanvasElement });
function recipe() {
	return normalizeImageDevelopStateV1OrV2({ ...defaultImageDevelopStateV2(),
		effects: [createVideoEffect('tone-ladder-v1', { id: 'tone', params: { exposure: -1 } }),
			createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropX: 0.2, cropWidth: 0.8 } })],
		masks: [{ schemaVersion: 1, id: 'mask', kind: 'mask', inputs: [],
			nodes: [{ id: 'range', kind: 'luminance-range', lower: 0.1, upper: 0.2, falloff: 0.1 }], outputNodeId: 'range' }],
		maskBindings: [{ maskId: 'mask', effectId: 'tone' }] });
}
function view(target: ReturnType<typeof targets>, mode?: DisplayView['maskOverlayMode'], resolution: 'proxy' | 'full' = 'proxy'): DisplayView {
	return { photoId: 'photo', revision: 7, resolution, develop: recipe(), maskOverlay: { maskId: 'mask', effectId: 'tone' },
		...(mode === undefined ? {} : { maskOverlayMode: mode }), ...target };
}
function preview(pixels: readonly number[]) {
	const frame = rgbaFrame(pixels);
	return { photoId: 'photo', tier: 'fit-screen' as const, descriptor: frame.descriptor, byteLength: frame.pixels.byteLength,
		outputSha256: createHash('sha256').update(frame.pixels).digest('hex'), body: new Blob([frame.pixels]) };
}
function harness(pixels: readonly number[], runtime: PhotoLibraryDevelopProxyRuntimeV2) {
	const painted = new Map<HTMLCanvasElement, number[]>(), backings: PixelFrameV1['pixels'][] = [], clears: HTMLCanvasElement[] = [];
	const ports: ConstructorParameters<typeof PhotoLibraryDevelopPresentationV2>[0] = {
		async readPreview() { assert.equal(this, ports); return { outcome: 'ready' as const, preview: preview(pixels), cache: 'hit' as const, notices: [] }; },
		withOriginalFrame: (async (_request, consume) => {
			const frame = rgbaFrame(pixels); backings.push(frame.pixels);
			try { return await consume({ photoId: 'photo', revision: 7, frame }); } finally { frame.pixels.fill(0); }
		}) satisfies NonNullable<ConstructorParameters<typeof PhotoLibraryDevelopPresentationV2>[0]['withOriginalFrame']>,
		async loadProxy() { assert.equal(this, ports); return runtime; },
		paint(canvas: HTMLCanvasElement, frame: PixelFrameV1) { assert.equal(this, ports); painted.set(canvas, [...frame.pixels]); backings.push(frame.pixels);
			return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength }; },
		clear(canvas: HTMLCanvasElement) { assert.equal(this, ports); clears.push(canvas); },
	};
	return { owner: new PhotoLibraryDevelopPresentationV2(ports), painted, backings, clears };
}

for (const resolution of ['proxy', 'full'] as const) test(`${resolution} grayscale paints the actual projected range while readiness waits for the joined real renderer`, async () => {
	const actual = createPhotoDevelopRenderRuntimeV2(), entered = deferred<void>(), release = deferred<void>(), target = targets();
	const retained: PixelFrameV1['pixels'][] = [];
	const hold: PhotoLibraryDevelopProxyRuntimeV2['withProxy'] = (request, consume) => {
		assert.deepEqual(request.maskOverlay, { maskId: 'mask', effectId: 'tone' }); assert.equal(Object.hasOwn(request, 'maskOverlayMode'), false);
		return actual[resolution === 'full' ? 'withFullResolution' : 'withProxy'](request, async output => {
			assert.ok(output.maskOverlay); assert.deepEqual([...output.maskOverlay.coverage], RANGE_COVERAGE);
			retained.push(output.frame.pixels, output.maskOverlay.coverage); const result = await consume(output);
			entered.resolve(); await release.promise; return result;
		});
	};
	const state = harness(ORIGINAL, { withProxy: hold, withFullResolution: hold });
	try {
		state.owner.setView(view(target, 'grayscale', resolution)); await Promise.race([entered.promise, state.owner.drain()]);
		assert.deepEqual(state.painted.get(target.before), ORIGINAL); assert.deepEqual(state.painted.get(target.after), RANGE_AFTER);
		assert.deepEqual(state.painted.get(target.overlay), grayscale(RANGE_COVERAGE));
		assert.equal(state.owner.snapshot().status, 'pending'); assert.equal(state.owner.snapshot().extent, null);
		assert.equal(await remainsPending(state.owner.drain()), true); assert.equal(retained[1]?.[0], 223);
		release.resolve(); await state.owner.drain(); assert.equal(state.owner.snapshot().status, 'ready');
		assert.deepEqual(state.owner.snapshot().extent, { before: { width: 5, height: 1 }, after: { width: 4, height: 1 } });
		assert.ok([...retained, ...state.backings].every(bytes => bytes.every(byte => byte === 0)));
		assert.equal(Object.hasOwn(state.owner.snapshot(), 'maskOverlayMode'), false);
		await state.owner.close(); assert.deepEqual(state.clears, [target.before, target.after, target.overlay]);
	} finally { release.resolve(); await state.owner.close(); }
});

test('absent mode retains literal legacy color bytes and switching presentation changes neither recipe, After nor histograms', async () => {
	const target = targets(), state = harness(ORIGINAL, createPhotoDevelopRenderRuntimeV2()), request = view(target), wire = JSON.stringify(request.develop);
	try {
		state.owner.setView(request); await state.owner.drain(); const first = state.owner.snapshot();
		assert.equal(first.status, 'ready'); assert.deepEqual(state.painted.get(target.overlay), color(RANGE_COVERAGE));
		state.owner.setView({ ...request, maskOverlayMode: 'grayscale' }); await state.owner.drain(); const second = state.owner.snapshot();
		assert.equal(second.status, 'ready'); assert.deepEqual(state.painted.get(target.overlay), grayscale(RANGE_COVERAGE));
		assert.deepEqual(state.painted.get(target.after), RANGE_AFTER); assert.deepEqual(second.before, first.before); assert.deepEqual(second.after, first.after);
		assert.deepEqual(second.extent, first.extent); assert.equal(JSON.stringify(request.develop), wire); assert.equal(Object.hasOwn(request.develop, 'displayMode'), false);
		state.owner.setView({ ...request, maskOverlayMode: 'color' }); await state.owner.drain(); assert.deepEqual(state.painted.get(target.overlay), color(RANGE_COVERAGE));
	} finally { await state.owner.close(); }
});

function body(alpha: readonly number[]) {
	const bytes = new Uint8Array(alpha.length + 16); bytes.set([83, 67, 77, 65, 83, 75, 48, 49]);
	const header = new DataView(bytes.buffer); header.setUint32(8, alpha.length, true); header.setUint32(12, 1, true); bytes.set(alpha, 16);
	return { bytes, storageKey: `brush-mask-v1:${String(alpha.length)}:1:${createHash('sha256').update(bytes).digest('hex')}` };
}
for (const resolution of ['proxy', 'full'] as const) test(`${resolution} grayscale uses authenticated composed brush coverage after real suffix geometry`, async () => {
	const bodies = [body([0, 64, 192, 255]), body([255, 192, 64, 0])], reads: string[] = [];
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(reference, consume) {
		assert.equal(this, maskSource); reads.push(reference.storageKey);
		const supplied = bodies.find(candidate => candidate.storageKey === reference.storageKey); assert.ok(supplied); return consume(supplied.bytes);
	} };
	const effects = [createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } }),
		createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } })];
	const masks = bodies.map((supplied, index) => ({ schemaVersion: 1, id: index === 0 ? 'selected' : 'operand', kind: 'matte',
		inputs: [{ name: 'paint', kind: 'alpha', sourceRef: supplied.storageKey }, { name: 'unused', kind: 'alpha', sourceRef: supplied.storageKey }],
		nodes: [{ id: 'alpha', kind: 'alpha', inputName: 'paint' }], outputNodeId: 'alpha' }));
	const develop = manageImageDevelopMasksV3({ ...defaultImageDevelopStateV2(), effects, masks, maskBindings: [{ maskId: 'selected', effectId: 'invert' }] },
		{ type: 'compose', maskId: 'selected', operandMaskId: 'operand', operation: 'subtract' });
	const pixels = [0, 0, 0, 0, 0, 0, 0, 128, 0, 0, 0, 1, 0, 0, 0, 255], target = targets();
	const state = harness(pixels, createPhotoDevelopRenderRuntimeV2({ maskSource })), originalBodies = bodies.map(supplied => [...supplied.bytes]);
	try {
		state.owner.setView({ ...view(target, 'grayscale', resolution), develop, maskOverlay: { maskId: 'selected', effectId: 'invert' } }); await state.owner.drain();
		assert.equal(state.owner.snapshot().status, 'ready'); assert.deepEqual(state.painted.get(target.before), pixels);
		assert.deepEqual(state.painted.get(target.after), [255, 255, 255, 255, 224, 224, 224, 1, 136, 136, 136, 128, 0, 0, 0, 0]);
		assert.deepEqual(state.painted.get(target.overlay), grayscale([255, 191, 63, 0]));
		assert.deepEqual([...reads].sort(), bodies.map(supplied => supplied.storageKey).sort());
		assert.deepEqual(bodies.map(supplied => [...supplied.bytes]), originalBodies); assert.ok(state.backings.every(bytes => bytes.every(byte => byte === 0)));
	} finally { await state.owner.close(); for (const supplied of bodies) supplied.bytes.fill(0); }
});

test('display mode and selection detach synchronously before a lazy runtime can yield or callers can change them', async () => {
	const target = targets(), entered = deferred<void>(), release = deferred<void>(), actual = createPhotoDevelopRenderRuntimeV2();
	const mutable = { ...view(target, 'grayscale'), maskOverlay: { maskId: 'mask', effectId: 'tone' } };
	const prepared = preparePhotoDevelopPresentationViewV2(mutable) as DisplayView;
	mutable.maskOverlayMode = 'color'; mutable.maskOverlay.maskId = 'changed'; mutable.maskOverlay.effectId = 'changed';
	assert.equal(prepared.maskOverlayMode, 'grayscale'); assert.deepEqual(prepared.maskOverlay, { maskId: 'mask', effectId: 'tone' });
	assert.ok(Object.isFrozen(prepared)); assert.ok(Object.isFrozen(prepared.maskOverlay));
	const state = harness(ORIGINAL, { withFullResolution: actual.withFullResolution, withProxy: async (request, consume) => {
		entered.resolve(); await release.promise; return actual.withProxy(request, consume);
	} });
	try {
		state.owner.setView(prepared); await Promise.race([entered.promise, state.owner.drain()]); release.resolve(); await state.owner.drain();
		assert.equal(state.owner.snapshot().status, 'ready'); assert.deepEqual(state.painted.get(target.overlay), grayscale(RANGE_COVERAGE));
	} finally { release.resolve(); await state.owner.close(); }
});

test('closed mode admission refuses invalid, orphaned and accessor metadata before any source capability is acquired', async () => {
	const target = targets(); let calls = 0, getters = 0;
	const state = new PhotoLibraryDevelopPresentationV2({ readPreview: async () => { calls++; return { outcome: 'missing' }; },
		loadProxy: async () => { calls++; return createPhotoDevelopRenderRuntimeV2(); }, paint: () => { calls++; return { width: 0, height: 0, byteLength: 0 }; }, clear() {} });
	try {
		for (const mode of ['heatmap', '', null, false, {}, { toString() { getters++; return 'grayscale'; } }]) {
			assert.throws(() => state.setView({ ...view(target), maskOverlayMode: mode } as DisplayView));
		}
		for (const orphan of [{ photoId: 'photo', develop: recipe(), before: target.before, after: target.after, maskOverlayMode: 'grayscale' },
			{ ...view(target, 'grayscale'), overlay: undefined }, { ...view(target, 'grayscale'), maskOverlay: undefined },
			{ ...view(target, 'grayscale'), maskOverlay: { maskId: 'mask', effectId: 'tone', displayMode: 'grayscale' } }]) {
			assert.throws(() => preparePhotoDevelopPresentationViewV2(orphan));
		}
		assert.throws(() => preparePhotoDevelopPresentationViewV2({ ...view(target), get maskOverlayMode() { getters++; return 'grayscale'; } }));
		assert.throws(() => preparePhotoDevelopPresentationViewV2({ ...view(target, 'grayscale'), maskOverlay: { maskId: 'mask', get effectId() { getters++; return 'tone'; } } }));
		assert.equal(getters, 0); await state.drain(); assert.equal(calls, 0); assert.equal(state.snapshot().status, 'idle');
	} finally { await state.close(); }
});

test('replacing a held grayscale render seals its targets and joins old pixels before publishing current color', async () => {
	const first = targets(), second = targets(), entered = deferred<void>(), release = deferred<void>(), actual = createPhotoDevelopRenderRuntimeV2();
	const retained: PixelFrameV1['pixels'][] = []; let calls = 0;
	const state = harness(ORIGINAL, { withFullResolution: actual.withFullResolution, withProxy: (request, consume) => {
		const ordinal = ++calls; return actual.withProxy(request, async output => {
			if (ordinal === 1) { assert.ok(output.maskOverlay); retained.push(output.frame.pixels, output.maskOverlay.coverage); entered.resolve(); await release.promise; }
			return consume(output);
		});
	} });
	try {
		state.owner.setView(view(first, 'grayscale')); await Promise.race([entered.promise, state.owner.drain()]);
		state.owner.setView(view(second, 'color')); assert.equal(await remainsPending(state.owner.drain()), true); assert.equal(calls, 1);
		assert.equal(retained[1]?.[0], 223); assert.deepEqual(state.clears, [first.before, first.after, first.overlay]);
		release.resolve(); await state.owner.drain(); assert.equal(calls, 2); assert.equal(state.owner.snapshot().status, 'ready');
		assert.equal(state.painted.has(first.after), false); assert.equal(state.painted.has(first.overlay), false);
		assert.deepEqual(state.painted.get(second.overlay), color(RANGE_COVERAGE)); assert.ok(retained.every(bytes => bytes.every(byte => byte === 0)));
	} finally { release.resolve(); await state.owner.close(); }
});

test('Close joins held grayscale output, keeps coverage live until retirement and cannot publish ready afterward', async () => {
	const entered = deferred<void>(), release = deferred<void>(), target = targets(), actual = createPhotoDevelopRenderRuntimeV2(), retained: PixelFrameV1['pixels'][] = [];
	const state = harness(ORIGINAL, { withFullResolution: actual.withFullResolution, withProxy: (request, consume) => actual.withProxy(request, async output => {
		assert.ok(output.maskOverlay); retained.push(output.frame.pixels, output.maskOverlay.coverage); entered.resolve(); await release.promise; return consume(output);
	}) });
	try {
		state.owner.setView(view(target, 'grayscale')); await Promise.race([entered.promise, state.owner.drain()]);
		const closing = state.owner.close(); assert.equal(await remainsPending(closing), true); assert.equal(retained[1]?.[0], 223);
		release.resolve(); await closing; assert.equal(state.owner.snapshot().status, 'idle'); assert.equal(state.owner.snapshot().extent, null);
		assert.equal(state.painted.has(target.after), false); assert.equal(state.painted.has(target.overlay), false);
		assert.deepEqual(state.clears, [target.before, target.after, target.overlay]); assert.ok(retained.every(bytes => bytes.every(byte => byte === 0)));
	} finally { release.resolve(); await state.owner.close(); }
});

test('a failed grayscale paint retains its real renderer failure and wipes the borrowed display plane before Close', async () => {
	const target = targets(), actual = createPhotoDevelopRenderRuntimeV2();
	const token = Proxy.revocable({}, {}); token.revoke(); const primary: unknown = token.proxy;
	const retained: PixelFrameV1['pixels'][] = [], observed: { reason?: unknown } = {};
	const runtime: PhotoLibraryDevelopProxyRuntimeV2 = { withFullResolution: actual.withFullResolution,
		withProxy: (request, consume) => actual.withProxy(request, consume).catch((error: unknown) => { observed.reason = error; throw error; }) };
	const owner = new PhotoLibraryDevelopPresentationV2({ readPreview: async () => ({ outcome: 'ready', preview: preview(ORIGINAL), cache: 'hit', notices: [] }),
		loadProxy: async () => runtime, paint(canvas, frame) {
			if (canvas === target.overlay) { retained.push(frame.pixels); assert.deepEqual([...frame.pixels], grayscale(RANGE_COVERAGE)); throw primary; }
			return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength };
		}, clear() {} });
	try {
		owner.setView(view(target, 'grayscale')); await owner.drain();
		assert.equal(observed.reason, primary); assert.equal(retained.length, 1); assert.ok(retained[0]?.every(byte => byte === 0));
		assert.equal(owner.snapshot().status, 'failed'); assert.equal(owner.snapshot().extent, null);
	} finally { await owner.close(); }
});

test('UI mask display capture is a closed detached choice with canonical defaults and no getter or coercion execution', () => {
	assert.equal(preparePhotoDevelopMaskDisplayModeV1(undefined), 'color');
	assert.deepEqual(preparePhotoDevelopMaskDisplaySelectionV1({ maskId: 'mask', effectId: 'tone' }), { maskId: 'mask', effectId: 'tone', displayMode: 'color' });
	const mutable = { maskId: 'mask', effectId: 'tone', displayMode: 'grayscale' }, captured = preparePhotoDevelopMaskDisplaySelectionV1(mutable);
	mutable.maskId = 'different'; mutable.effectId = 'different'; mutable.displayMode = 'color';
	assert.deepEqual(captured, { maskId: 'mask', effectId: 'tone', displayMode: 'grayscale' }); assert.ok(Object.isFrozen(captured));
	const base = { maskId: 'mask', effectId: 'tone', displayMode: 'grayscale' }; let inspected = 0;
	const coercion = { toString() { inspected++; return 'grayscale'; }, [Symbol.toPrimitive]() { inspected++; return 'grayscale'; } };
	for (const mode of ['', 'heatmap', null, false, 1, [], coercion, Reflect.construct(String, ['grayscale']) as unknown]) {
		assert.throws(() => preparePhotoDevelopMaskDisplayModeV1(mode), TypeError);
		assert.throws(() => preparePhotoDevelopMaskDisplaySelectionV1({ ...base, displayMode: mode }), TypeError);
	}
	for (const invalid of [{ ...base, extra: true }, { ...base, [Symbol('extra')]: true }, Object.create(base) as unknown,
		{ ...base, maskId: '' }, { ...base, effectId: 'not a stable ID' }, { ...base, maskId: 'm'.repeat(129) },
		{ ...base, maskId: coercion }, { ...base, effectId: coercion }]) {
		assert.throws(() => preparePhotoDevelopMaskDisplaySelectionV1(invalid), TypeError);
	}
	for (const key of ['maskId', 'effectId', 'displayMode']) {
		const accessor = { ...base }; Object.defineProperty(accessor, key, { enumerable: true, get() { inspected++; return base[key as keyof typeof base]; } });
		assert.throws(() => preparePhotoDevelopMaskDisplaySelectionV1(accessor), TypeError);
	}
	assert.equal(inspected, 0); assert.deepEqual(base, { maskId: 'mask', effectId: 'tone', displayMode: 'grayscale' });
});

test('grayscale display retirement bypasses a paint-shadowed fill and preserves the exact opaque paint primary', async () => {
	const target = targets(), actual = createPhotoDevelopRenderRuntimeV2(), observed: { reason?: unknown } = {};
	const token = Proxy.revocable({}, {}); token.revoke(); const primary: unknown = token.proxy, cleanup = Symbol('hostile fill');
	const retained: Uint8Array<ArrayBuffer>[] = []; let getters = 0;
	const runtime: PhotoLibraryDevelopProxyRuntimeV2 = { withFullResolution: actual.withFullResolution,
		withProxy: (request, consume) => actual.withProxy(request, consume).catch((error: unknown) => { observed.reason = error; throw error; }) };
	const owner = new PhotoLibraryDevelopPresentationV2({ readPreview: async () => ({ outcome: 'ready', preview: preview(ORIGINAL), cache: 'hit', notices: [] }),
		loadProxy: async () => runtime, paint(canvas, frame) {
			if (canvas === target.overlay) {
				assert.deepEqual([...frame.pixels], grayscale(RANGE_COVERAGE)); retained.push(new Uint8Array(frame.pixels.buffer));
				Object.defineProperty(frame.pixels, 'fill', { get() { getters++; throw cleanup; } }); throw primary;
			}
			return { width: frame.descriptor.width, height: frame.descriptor.height, byteLength: frame.pixels.byteLength };
		}, clear() {} });
	try {
		owner.setView(view(target, 'grayscale')); await owner.drain();
		assert.equal(observed.reason, primary); assert.equal(getters, 0); assert.equal(retained.length, 1);
		assert.ok(retained[0]?.every(byte => byte === 0)); assert.equal(owner.snapshot().status, 'failed'); assert.equal(owner.snapshot().extent, null);
	} finally { await owner.close(); }
});
