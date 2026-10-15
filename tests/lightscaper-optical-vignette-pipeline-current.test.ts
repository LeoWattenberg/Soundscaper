/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoDevelopRenderRuntimeCurrentV1 } from '../src/lightscaper/photo-develop-render-runtime-current-v1.ts';
import { defaultImageDevelopStateV2 } from '../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateCurrentV1 } from '../src/common/editor/imaging/image-develop-state-current-v1.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { withImageDevelopFrameV3 } from '../src/common/editor/imaging/image-develop-frame-v3.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../src/common/editor/photo-library-develop-full-resolution-port-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

test('actual Current native renderer applies the literal optical corner gain while retaining the Original', async () => {
	const pixels = Float32Array.of(.125, .25, .5, 1, .125, .25, .5, 1, .125, .25, .5, 1, .125, .25, .5, 1);
	const frame = { descriptor: { schemaVersion: 1 as const, width: 2, height: 2, sampleFormat: 'float32' as const,
		primaries: 'srgb' as const, transfer: 'linear' as const }, pixels };
	const before = pixels.slice(), develop = { ...defaultImageDevelopStateV2(), effects: [{ id: 'optical', type: 'optical-vignette-v1', enabled: true, params: { amount: 100 } }] };
	const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution({ frame, develop, signal: new AbortController().signal }, view => [...view.frame.pixels]);
	// Every2×2 pixel center has radius²1/4, so Amount100 gains sqrt(2).
	const expected = Array.from({ length: 4 }, () => [Math.fround(.125 * Math.SQRT2), Math.fround(.25 * Math.SQRT2), Math.fround(.5 * Math.SQRT2), 1]).flat();
	assert.deepEqual(result, expected); assert.deepEqual(pixels, before); assert.equal(develop.processVersion, 2);
});

const effect = (amount = 100, enabled = true) => ({ id: 'optical', type: 'optical-vignette-v1', enabled, params: { amount } });
const recipe = (effects: readonly unknown[], extras: Readonly<Record<string, unknown>> = {}) => normalizeImageDevelopStateCurrentV1({ ...defaultImageDevelopStateV2(), effects, ...extras });
const graph = (node: unknown) => ({ schemaVersion: 1, id: 'local', kind: 'mask', inputs: [], nodes: [node], outputNodeId: 'coverage' });
const gradient = () => graph({ id: 'coverage', kind: 'linear-gradient', start: { x: 0, y: 0 }, end: { x: 1, y: 0 } });
const binding = [{ maskId: 'local', effectId: 'optical' }], selected = { maskId: 'local', effectId: 'optical' };
const frame = (pixels: readonly number[], native: boolean): PixelFrameV1 => native
	? { descriptor: { schemaVersion: 1, width: pixels.length / 4, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' }, pixels: Float32Array.from(pixels) }
	: { descriptor: { schemaVersion: 1, width: pixels.length / 4, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: Uint8Array.from(pixels) };
const request = (frame: PixelFrameV1, develop: ReturnType<typeof recipe>) => ({ frame, develop, signal: new AbortController().signal });

test('Current byte optical vignette lifts and attenuates linear light with literal encoded output and an exact center', async () => {
	const source = frame([64, 32, 16, 255, 64, 32, 16, 128, 64, 32, 16, 255], false), before = source.pixels.slice();
	for (const entry of [{ amount: 100, side: [84, 44, 24] }, { amount: -100, side: [48, 23, 10] }]) {
		const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request(source, recipe([effect(entry.amount)])), view => [...view.frame.pixels]);
		assert.deepEqual(result, [...entry.side, 255, 64, 32, 16, 128, ...entry.side, 255]);
	}
	assert.deepEqual(source.pixels, before);
});

test('native optical vignette retains signed HDR values and zero signs while copying transparent hidden RGB', async () => {
	const source = frame([-.5, -0, 4, .25, .125, -0, 2, 1, -2, Math.fround(1e-40), -0, -0], true), before = new Uint8Array(source.pixels.buffer).slice();
	for (const amount of [100, -100, .125]) {
		const gain = 2 ** (2 * amount / 100 * .4);
		const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request(source, recipe([effect(amount)])), view => [...view.frame.pixels]);
		assert.deepEqual(result, [Math.fround(-.5 * gain), -0, Math.fround(4 * gain), .25, .125, -0, 2, 1, -2, Math.fround(1e-40), -0, -0]);
	}
	assert.deepEqual(new Uint8Array(source.pixels.buffer), before);
	const hidden = frame([17, 88, 241, 0, 64, 32, 16, 255, 219, 9, 67, 0], false);
	const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request(hidden, recipe([effect()])), view => [...view.frame.pixels]);
	assert.deepEqual(result, [...hidden.pixels]);
});

test('native masked optical vignette preserves unchanged negative-zero center components and hidden alpha bits', async () => {
	const source = frame([-.25, -0, 2, 1, .125, -0, 4, .5, -.125, -0, 3, -0], true), before = new Uint8Array(source.pixels.buffer).slice();
	const develop = recipe([effect()], { masks: [gradient()], maskBindings: binding });
	const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request(source, develop), view => new Uint8Array(view.frame.pixels.buffer).slice());
	const gain = 2 ** .8, amount = 43 / 255;
	const expected = Float32Array.of(Math.fround(-.25 + amount * (Math.fround(-.25 * gain) + .25)), -0,
		Math.fround(2 + amount * (Math.fround(2 * gain) - 2)), 1, .125, -0, 4, .5, -.125, -0, 3, -0);
	assert.deepEqual(result, new Uint8Array(expected.buffer)); assert.deepEqual(new Uint8Array(source.pixels.buffer), before);
});

test('optical vignette recenters on effect-list crop order while legacy geometry still executes first', async () => {
	const source = frame([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], true), runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	const crop = createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropWidth: 2 / 3 } });
	const render = (develop: ReturnType<typeof recipe>) => runtime.withFullResolution(request(source, develop), view => {
		assert.deepEqual([view.frame.descriptor.width, view.frame.descriptor.height], [2, 1]); return [...view.frame.pixels];
	});
	const beforeCrop = await render(recipe([effect(), crop])), afterCrop = await render(recipe([crop, effect()]));
	const side = Math.fround(2 ** .8), recentered = Math.fround(2 ** .4);
	assert.deepEqual(beforeCrop, [side, side, side, 1, 1, 1, 1, 1]);
	assert.deepEqual(afterCrop, [recentered, recentered, recentered, 1, recentered, recentered, recentered, 1]);
	const geometry = { ...defaultImageDevelopStateV2().geometry, crop: { x: 0, y: 0, width: 2 / 3, height: 1 } };
	assert.deepEqual(await render(recipe([effect()], { geometry })), afterCrop); assert.notDeepEqual(beforeCrop, afterCrop);
});

test('native optical masks observe incoming exposure before radial gain and keep destination-grid coverage', async () => {
	const source = frame([.125, .125, .125, 1, .25, .25, .25, 1, .5, .5, .5, 1], true);
	const exposure = createVideoEffect('tone-ladder-v1', { id: 'exposure', params: { exposure: 1 } });
	const develop = recipe([exposure, effect()], { masks: [graph({ id: 'coverage', kind: 'luminance-range', lower: .2, upper: .3, falloff: 0 })], maskBindings: binding });
	const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution({ ...request(source, develop), maskOverlay: selected }, view => {
		assert.ok(view.maskOverlay); assert.deepEqual([...view.maskOverlay.coverage], [255, 0, 0]); return [...view.frame.pixels];
	});
	const lifted = Math.fround(.25 * 2 ** .8);
	assert.deepEqual(result, [lifted, lifted, lifted, 1, .5, .5, .5, 1, 1, 1, 1, 1]);
});

for (const native of [false, true]) test(`${native ? 'native' : 'byte'} optical mask overlay transports through later lens and geometry without an optical warp`, async () => {
	const source = frame(native ? [.25, .25, .25, 1, .25, .25, .25, 1, .25, .25, .25, 1]
		: [64, 64, 64, 255, 64, 64, 64, 255, 64, 64, 64, 255], native);
	const runtime = createPhotoDevelopRenderRuntimeCurrentV1(), masks = [gradient()], maskBindings = binding;
	await runtime.withFullResolution({ ...request(source, recipe([effect()], { masks, maskBindings })), maskOverlay: selected }, view => {
		assert.ok(view.maskOverlay); assert.deepEqual([...view.maskOverlay.coverage], [43, 128, 213]);
	});
	const effects = [effect(), createVideoEffect('lens-distortion-v1', { id: 'lens', params: { amount: 100 } }),
		createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropWidth: 2 / 3, rotationDegrees: 90 } })];
	await runtime.withFullResolution({ ...request(source, recipe(effects, { masks, maskBindings })), maskOverlay: selected }, view => {
		assert.ok(view.maskOverlay); assert.deepEqual([view.maskOverlay.width, view.maskOverlay.height], [1, 2]);
		assert.deepEqual([...view.maskOverlay.coverage], [38, 128]);
	});
});

for (const processVersion of [1, 2, 3]) test(`Current optical vignette preserves authored process${processVersion} for byte and native Originals`, async () => {
	for (const native of [false, true]) {
		const source = frame(native ? [.125, .25, .5, 1, .25, .5, 1, 1, .5, 1, 2, 1] : [32, 64, 128, 255, 64, 128, 255, 255, 128, 255, 64, 255], native);
		const develop = recipe([effect()], { processVersion, ...(processVersion === 3 ? { repairs: { schemaVersion: 1, spots: [] } } : {}) });
		const serialized = JSON.stringify(develop); await createPhotoDevelopRenderRuntimeCurrentV1().withProxy(request(source, develop), () => undefined);
		assert.equal(JSON.stringify(develop), serialized); assert.equal(develop.processVersion, processVersion);
	}
});

test('zero amount disabled optical and the exact center preserve native bits without a transfer roundtrip', async () => {
	const source = frame([-0, Math.fround(1e-40), 2, .25, -.5, -0, 4, -0], true), before = new Uint8Array(source.pixels.buffer).slice();
	for (const value of [effect(0), effect(-100, false)]) {
		const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request(source, recipe([value])), view => new Uint8Array(view.frame.pixels.buffer).slice());
		assert.deepEqual(result, before);
	}
	const center = frame([-.25, -0, 2, .5], true), bits = new Uint8Array(center.pixels.buffer).slice();
	for (const amount of [-100, 100]) {
		const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request(center, recipe([effect(amount)], { masks: [gradient()], maskBindings: binding })), view => new Uint8Array(view.frame.pixels.buffer).slice());
		assert.deepEqual(result, bits);
	}
});

test('optical metadata and aggregate masked stage quotas refuse before Original pixels', async () => {
	let reads = 0; const runtime = createPhotoDevelopRenderRuntimeCurrentV1();
	const source = { descriptor: frame([.25, .5, 1, 1], true).descriptor, get pixels(): never { reads++; throw new Error('Native Original pixels'); } } as PixelFrameV1;
	for (const value of [effect(Infinity), effect(NaN, false), effect(-101)]) {
		await assert.rejects(runtime.withFullResolution({ frame: source, develop: { ...defaultImageDevelopStateV2(), effects: [value] }, signal: new AbortController().signal }, () => assert.fail('Invalid optical vignette delivered.')), RangeError);
	}
	const large = { descriptor: { ...source.descriptor, width: 8192, height: 2048 }, get pixels(): never { reads++; throw new Error('Large Original pixels'); } } as PixelFrameV1;
	const develop = recipe([effect()], { masks: [graph({ id: 'coverage', kind: 'vector-shape', shape: 'rectangle', x: 0, y: 0, width: 1, height: 1 })], maskBindings: binding });
	await assert.rejects(runtime.withFullResolution(request(large, develop), () => assert.fail('Unbounded optical stage delivered.')), /768 MiB/u);
	assert.equal(reads, 0);
});

test('Current optical admission retains supported padded views and charges their entire physical backing', async () => {
	const descriptor = { ...frame([.25, -0, 2, 1], true).descriptor, sampleFormat: 'float32' as const }, smallBacking = new ArrayBuffer(96), small = new Float32Array(smallBacking, 16, 4);
	small.set([.25, -0, 2, 1]); const before = new Uint8Array(smallBacking).slice();
	const result = await createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request({ descriptor, pixels: small }, recipe([effect()])), view => [...view.frame.pixels]);
	assert.deepEqual(result, [.25, -0, 2, 1]); assert.deepEqual(new Uint8Array(smallBacking), before);
	const largeBacking = new ArrayBuffer(768 * 1024 * 1024), large = new Float32Array(largeBacking, 16, 4); large.set([.25, -0, 2, 1]);
	await assert.rejects(createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request({ descriptor, pixels: large }, recipe([effect()])), () => assert.fail('Uncharged physical Original delivered.')), /768 MiB physical backing/u);
	assert.deepEqual([...large], [.25, -0, 2, 1]);
});

test('native optical overflow refuses finite Float32 delivery while preserving the Original', async () => {
	const maximum = 3.4028234663852886e38, source = frame([maximum, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], true), before = source.pixels.slice();
	await assert.rejects(createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution(request(source, recipe([effect()])), () => assert.fail('Overflowed native optical output delivered.')), /finite|Float32/u);
	assert.deepEqual(source.pixels, before);
});

test('the permanent byte V3 facade retains its prior optical-family refusal', async () => {
	await assert.rejects(withImageDevelopFrameV3({ frame: frame([64, 32, 16, 255], false), develop: recipe([effect()]) }, () => assert.fail('Permanent V3 gained optical vignette.'), PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1), /Unsupported photo proxy effect/u);
});

for (const native of [false, true]) test(`Current ${native ? 'native' : 'byte'} optical vignette joins a held consumer then retires output and coverage on opaque cancellation`, async () => {
	const source = frame(native ? [.125, .25, .5, 1, .25, .5, 1, 1, .5, 1, 2, 1] : [32, 64, 128, 255, 64, 128, 255, 255, 128, 255, 64, 255], native);
	const before = source.pixels.slice(), develop = recipe([effect()], { masks: [gradient()], maskBindings: binding });
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	let pixels: PixelFrameV1['pixels'] | undefined, coverage: Uint8Array<ArrayBuffer> | undefined;
	const work = createPhotoDevelopRenderRuntimeCurrentV1().withFullResolution({ frame: source, develop, signal: stop.signal, maskOverlay: selected }, async view => {
		assert.ok(view.maskOverlay); pixels = view.frame.pixels; coverage = view.maskOverlay.coverage; entered.resolve(); await release.promise;
	});
	const observed = work.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	try {
		await Promise.race([entered.promise, work]); stop.abort(opaque.proxy); assert.equal(await remainsPending(observed), true);
		assert.ok(pixels?.some(value => value !== 0) && coverage?.some(value => value !== 0)); release.resolve(); const result = await observed;
		assert.equal(result.ok, false); if (!result.ok) assert.ok(Object.is(result.error, opaque.proxy));
		assert.ok(pixels?.every(value => value === 0) && coverage?.every(value => value === 0)); assert.deepEqual(source.pixels, before);
	} finally { release.resolve(); await observed; }
});
