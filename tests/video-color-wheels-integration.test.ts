/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createVideoEffect, normalizeVideoEffect, VIDEO_EFFECT_TYPES, serializeVideoEffectsToFfmpegOperations } from '../src/common/editor/video-effects.js';
import { withGlobalDevelopPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-global-develop-v1.ts';
import { applyVideoExactBrowserEffectsFinishing } from '../src/framescaper/editor-video-exact-browser-effects-finishing.ts';
import { withPhotoDevelopProxyV1 } from '../src/lightscaper/controller/photo-develop-proxy-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizeScalarColorWheelsGradeV1 } from '../src/common/editor/video-color-wheels-scalar-v1.ts';

const wheel = (params: Readonly<Record<string, number>>, id = 'wheel') => ({ id, type: 'color-wheels-v1', enabled: true, params });
const descriptor = { schemaVersion: 1, width: 3, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' } as const;
const limits = { maximumSidePixels: 3, maximumPixels: 3, maximumBytes: 12 };

test('the scalar owner admits only closed detached LGG grades without borrowing legacy render or LUT authority', () => {
	const raw = { schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: 0.18, lift: [-2, 0, 2], gamma: [0.01, 1, 10], gain: [0, 1, 16], saturation: 1, lut: null };
	const admitted = normalizeScalarColorWheelsGradeV1(raw); raw.lift[0] = 1;
	assert.equal(admitted.lift[0], -2); assert.ok(Object.isFrozen(admitted)); assert.ok(Object.isFrozen(admitted.gamma));
	let inspected = 0;
	for (const change of [{ schemaVersion: 2 }, { exposureStops: 1 }, { contrast: 2 }, { pivot: 0.2 }, { saturation: 0 }, { lut: {} },
		{ lift: [-2.01, 0, 0] }, { gamma: [0, 1, 1] }, { gain: [1, 1, 16.01] }, { gain: [1, -0, 1] }, { future: true },
		{ lift: Object.defineProperty([0, 0, 0], '0', { get() { inspected++; return 0; } }) }]) {
		assert.throws(() => normalizeScalarColorWheelsGradeV1({ ...raw, ...change }));
	}
	assert.throws(() => normalizeScalarColorWheelsGradeV1(Object.defineProperty({ ...raw }, 'lut', { get() { inspected++; return null; } })));
	assert.equal(inspected, 0);
});

test('the shared registry persists exactly nine closed numeric wheel controls and owns export dispatch', () => {
	assert.equal(VIDEO_EFFECT_TYPES.filter(type => type === 'color-wheels-v1').length, 1);
	const effect = createVideoEffect('color-wheels-v1', { id: 'wheel', params: { midtonesLuminance: 100 } });
	assert.equal(Object.keys(effect.params).length, 9); assert.deepEqual(normalizeVideoEffect(effect), effect);
	assert.equal(serializeVideoEffectsToFfmpegOperations([effect]).length, 1);
	assert.deepEqual(serializeVideoEffectsToFfmpegOperations([createVideoEffect('color-wheels-v1')]), []);
	let calls = 0;
	const hostile = { ...effect, params: { get midtonesLuminance() { calls++; throw Error(); } } };
	assert.throws(() => normalizeVideoEffect(hostile)); assert.throws(() => createVideoEffect('color-wheels-v1', { params: hostile.params }));
	assert.throws(() => normalizeVideoEffect({ ...effect, future: true })); assert.equal(calls, 0);
	const disguised = { ...effect }; Object.defineProperty(disguised, 'type', { enumerable: true, get() { calls++; return 'color-wheels-v1'; } });
	assert.throws(() => normalizeVideoEffect(disguised)); assert.equal(calls, 0);
});

test('Frame and Photo execute the same scalar wheel goldens with hidden RGB and every straight alpha unchanged', async () => {
	const pixels = new Uint8Array([0,0,0,1,128,128,128,127,0,255,255,0]);
	const effects = [wheel({ shadowsHue: 0, shadowsSaturation: 100 })], expected = [123,0,0,1,172,112,112,127,123,249,249,0];
	assert.deepEqual([...(await applyVideoExactBrowserEffectsFinishing({ width: 3, height: 1, pixels }, effects, new AbortController().signal)).pixels], expected);
	assert.deepEqual(await withPhotoDevelopProxyV1({ frame: { descriptor, pixels }, develop: { ...defaultImageDevelopStateV1(), effects } }, view => [...view.frame.pixels]), expected);
	assert.deepEqual([...pixels], [0,0,0,1,128,128,128,127,0,255,255,0]);
});

test('literal ordered lift/gamma chains retain per-stage quantization in Frame and Photo', async () => {
	const pixels = new Uint8Array([0,0,0,1,128,128,128,127,255,255,255,255]);
	for (const [effects, expected] of [
		[[wheel({ shadowsLuminance: 25 }, 'lift'), wheel({ midtonesLuminance: 100 }, 'gamma')], [137,137,137,1,192,192,192,127,255,255,255,255]],
		[[wheel({ midtonesLuminance: 100 }, 'gamma'), wheel({ shadowsLuminance: 25 }, 'lift')], [71,71,71,1,192,192,192,127,255,255,255,255]],
	] as const) {
		assert.deepEqual([...(await applyVideoExactBrowserEffectsFinishing({ width: 3, height: 1, pixels }, effects, new AbortController().signal)).pixels], expected);
		assert.deepEqual(await withPhotoDevelopProxyV1({ frame: { descriptor, pixels }, develop: { ...defaultImageDevelopStateV1(), effects } }, view => [...view.frame.pixels]), expected);
	}
});

test('serial CPU execution derives only the current table and retires it before held output completion or opaque failure', async () => {
	const Native = Uint8Array, tables: Uint8Array[] = [], failure = new Proxy({}, { get() { throw Error('Opaque failure inspection'); }, getPrototypeOf() { throw Error('Opaque failure inspection'); } });
	globalThis.Uint8Array = new Proxy(Native, { construct(target, args, receiver) {
		if (args[0] === 1024) assert.ok(tables.every(table => table.every(byte => byte === 0)), 'Earlier tables must retire before the next stage.');
		const bytes = Reflect.construct(target, args, receiver) as Uint8Array<ArrayBuffer>; if (args[0] === 1024) tables.push(bytes); return bytes;
	} });
	let entered!: () => void, release!: () => void; const waiting = new Promise<void>(resolve => { entered = resolve; });
	const held = new Promise<void>(resolve => { release = resolve; }), signal = new AbortController(); let settled = false;
	try {
		const promise = withGlobalDevelopPixelFrameV1({ frame: { descriptor, pixels: new Native([0,0,0,0,128,128,128,1,255,255,255,127]) },
			effects: Array.from({ length: 65 }, (_, n) => wheel({ highlightsLuminance: 100 }, `wheel-${String(n)}`)), signal: signal.signal }, async frame => {
			assert.equal(tables.length, 65); assert.ok(tables.every(table => table.every(byte => byte === 0))); entered(); await held;
			assert.equal(frame.pixels[3], 0); throw failure;
		}, { limits, maximumEffects: 100_000 }).finally(() => { settled = true; });
		await Promise.race([waiting, promise]); signal.abort(17); await Promise.resolve(); assert.equal(settled, false); release();
		let caught: unknown; try { await promise; } catch (error) { caught = error; }
		assert.equal(caught, failure); assert.ok(tables.every(table => table.every(byte => byte === 0)));
	} finally { globalThis.Uint8Array = Native; release?.(); }
});

test('disabled malformed wheel recipes refuse before frame copies and consumer publication', async () => {
	let called = false, inspected = 0;
	const effect = { ...wheel({}), enabled: false, params: { get shadowsHue() { inspected++; return 0; } } };
	await assert.rejects(withGlobalDevelopPixelFrameV1({ frame: { descriptor, pixels: new Uint8Array(12) }, effects: [effect] }, () => { called = true; }, { limits }));
	assert.equal(inspected, 0); assert.equal(called, false);
});
