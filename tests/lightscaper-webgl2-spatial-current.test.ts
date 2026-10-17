/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { preparePixelFrameWebGl2SpatialCurrentV1 as prepare, readPixelFrameWebGl2SpatialCurrentV1 as read,
	isPixelFrameWebGl2SpatialCurrentV1 as isPrepared, writePixelFrameWebGl2SpatialCurrentV1 as write } from '../src/common/editor/imaging/pixel-frame-webgl2-spatial-current-v1.ts';
import { prepareLinearSpatialEffectV1, writeLinearSpatialEffectV1 } from '../src/common/editor/imaging/pixel-frame-linear-spatial-v1.ts';
import type { LinearWorkingPixelFrameV1 } from '../src/common/editor/imaging/image-develop-linear-frame-v1.ts';

const effect = (type: string, params: Readonly<Record<string, unknown>> = {}, enabled = true) => ({ id: type, type, enabled, params });
const descriptor = (width = 3, height = 1) => ({ schemaVersion: 1 as const, width, height, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const });
const source = (): LinearWorkingPixelFrameV1 => ({ descriptor: descriptor(), pixels: Float32Array.of(-.25, 2, 1e-30, 0, .125, .25, .5, .375, 1, -.5, -0, 1) });
const cases = [
	{ value: effect('detail-sharpen-v1', { amount: 50, threshold: 17 }), kind: 14, p0: [128, 17, 0, 0], p1: [0, 0, 0, 1], policy: 'neighborhood' },
	{ value: effect('post-crop-vignette-v1', { amount: -25, midpoint: 12.5, feather: 25, roundness: -50, highlights: 75 }), kind: 15,
		p0: [-64, 8192, 16384, -128], p1: [192, 0, 0, 1], policy: 'pointwise-coupled' },
	{ value: effect('clarity-v1', { amount: 73.25 }), kind: 16, p0: [188, 0, 0, 0], p1: [0, 0, 0, 1], policy: 'neighborhood' },
	{ value: effect('noise-reduction-v1', { luminance: 50, luminanceDetail: 25, luminanceContrast: 75, color: 100, colorDetail: 12.5, colorSmoothness: 37.5 }),
		kind: 17, p0: [128, 64, 192, 256], p1: [32, 96, 0, 1], policy: 'neighborhood' },
	{ value: effect('grain-v1', { amount: .5, size: 2.25, roughness: 75, seed: 23 }), kind: 18, p0: [1, 576, 192, 23], p1: [0, 0, 0, 1], policy: 'pointwise-coupled' },
	{ value: effect('texture-v1', { amount: -50 }), kind: 19, p0: [-128, 0, 0, 0], p1: [0, 0, 0, 1], policy: 'neighborhood' },
	{ value: effect('dehaze-v1', { amount: -73.25 }), kind: 20, p0: [-188, 94, 0, 0], p1: [0, 0, 0, 1], policy: 'pointwise-independent' },
] as const;

test('all seven private spatial passes retain exact prepared integer controls and frozen same-aperture descriptors', () => {
	for (const fixture of cases) {
		const pass = prepare(fixture.value, descriptor());
		assert.equal(pass.kind, fixture.kind); assert.equal(pass.type, fixture.value.type); assert.equal(pass.id, fixture.value.id);
		assert.deepEqual(pass.params0, fixture.p0); assert.deepEqual(pass.params1, fixture.p1);
		assert.equal(pass.enabled, true); assert.equal(pass.neutral, false); assert.equal(pass.supported, true); assert.equal(pass.inputPolicy, fixture.policy);
		assert.strictEqual(pass.sourceDescriptor, pass.descriptor); assert.deepEqual(pass.descriptor, descriptor());
		assert.ok(Object.isFrozen(pass)); assert.ok(Object.isFrozen(pass.params0)); assert.ok(Object.isFrozen(pass.params1)); assert.ok(Object.isFrozen(pass.descriptor));
		assert.strictEqual(read(pass), pass); assert.equal(isPrepared(pass), true); assert.equal(Reflect.set(pass.params0, '0', 999), false);
	}
});

for (const fixture of cases) test(`${fixture.value.type}: private writer delegates exact native CPU output and preserves borrowed source`, async () => {
	const input = source(), before = input.pixels.slice(), pass = prepare(fixture.value, input.descriptor);
	const native = prepareLinearSpatialEffectV1(fixture.value, input.descriptor), expected = new Float32Array(input.pixels.length), actual = new Float32Array(expected.length);
	assert.equal(native.scratchBytes, 0);
	await writeLinearSpatialEffectV1(native, input.pixels, expected, new Uint8Array(0)); await write(pass, input, actual);
	assert.deepEqual(new Uint32Array(actual.buffer), new Uint32Array(expected.buffer)); assert.deepEqual(input.pixels, before);
	assert.deepEqual(actual.slice(0, 4), input.pixels.slice(0, 4));
	for (let at = 3; at < actual.length; at += 4) assert.equal(Object.is(actual[at], input.pixels[at]), true);
});

test('native detail output obeys an independent linear-segment binomial literal without RGB clipping', async () => {
	const input: LinearWorkingPixelFrameV1 = { descriptor: descriptor(), pixels: Float32Array.of(
		0, 0, 0, 1, 2 ** -10, 2 ** -11, 2 ** -12, 1, 0, 0, 0, 1) };
	const target = new Float32Array(12), pass = prepare(effect('detail-sharpen-v1', { amount: 200, threshold: 0 }), input.descriptor);
	// All samples and overshoots stay on the exact linear transfer segment.
	// Each edge's blur is one quarter of the center; the center blur is half.
	await write(pass, input, target);
	assert.deepEqual(target, Float32Array.of(-(2 ** -11), -(2 ** -12), -(2 ** -13), 1,
		2 ** -9, 2 ** -10, 2 ** -11, 1, -(2 ** -11), -(2 ** -12), -(2 ** -13), 1));
});

test('quantized neutrality is distinct from raw authored enabled for all seven families', async () => {
	for (const fixture of cases) {
		const params = fixture.value.type === 'noise-reduction-v1' ? { luminance: .1, color: .1 } : { amount: .1 };
		const neutral = prepare(effect(fixture.value.type, params), descriptor()), disabled = prepare({ ...fixture.value, enabled: false }, descriptor());
		assert.equal(neutral.enabled, true); assert.equal(neutral.neutral, true); assert.equal(neutral.params1[3], 0); assert.equal(neutral.inputPolicy, 'copy');
		assert.equal(disabled.enabled, false); assert.equal(disabled.neutral, false); assert.equal(disabled.params1[3], 0); assert.equal(disabled.inputPolicy, 'copy');
		const input = source();
		for (const pass of [neutral, disabled]) {
			const target = new Float32Array(input.pixels.length); await write(pass, input, target);
			assert.deepEqual(new Uint32Array(target.buffer), new Uint32Array(input.pixels.buffer));
		}
	}
});

test('prepared dependency policy never calls a neighborhood output an Original pixel ancestor', () => {
	for (const type of ['detail-sharpen-v1', 'clarity-v1', 'texture-v1']) assert.equal(prepare(effect(type, { amount: 100 }), descriptor()).inputPolicy, 'neighborhood');
	assert.equal(prepare(effect('noise-reduction-v1', { color: 100 }), descriptor()).inputPolicy, 'neighborhood');
	assert.equal(prepare(effect('dehaze-v1', { amount: 100 }), descriptor()).inputPolicy, 'neighborhood');
	assert.equal(prepare(effect('dehaze-v1', { amount: -100 }), descriptor()).inputPolicy, 'pointwise-independent');
	assert.equal(prepare(effect('post-crop-vignette-v1', { amount: -100, highlights: 0 }), descriptor()).inputPolicy, 'pointwise-independent');
	assert.equal(prepare(effect('post-crop-vignette-v1', { amount: 100, highlights: 100 }), descriptor()).inputPolicy, 'pointwise-independent');
	assert.equal(prepare(effect('post-crop-vignette-v1', { amount: -100, highlights: 100 }), descriptor()).inputPolicy, 'pointwise-coupled');
});

test('caller parameter mutation cannot change uniforms or the retained private native plan', async () => {
	const params = { amount: 50, threshold: 17 }, raw = effect('detail-sharpen-v1', params), input = source();
	const pass = prepare(raw, input.descriptor), expected = new Float32Array(input.pixels.length);
	await writeLinearSpatialEffectV1(prepareLinearSpatialEffectV1(raw, input.descriptor), input.pixels, expected, new Uint8Array(0));
	params.amount = 200; params.threshold = 255; raw.id = 'replaced'; raw.enabled = false;
	const actual = new Float32Array(expected.length); await write(pass, input, actual);
	assert.deepEqual(new Uint32Array(actual.buffer), new Uint32Array(expected.buffer)); assert.equal(pass.id, 'detail-sharpen-v1'); assert.equal(pass.params0[0], 128);
});

test('inactive hostile params, forged identities and wrong descriptor chains refuse before pixel reflection', async () => {
	let probes = 0;
	const params = Object.defineProperty({}, 'amount', { enumerable: true, get() { probes++; return 0; } });
	assert.throws(() => prepare(effect('clarity-v1', params, false), descriptor()));
	assert.throws(() => prepare(effect('grain-v1', { seed: .25 }, false), descriptor()));
	assert.throws(() => prepare({ ...effect('clarity-v1'), extra: 1 }, descriptor()));
	const pass = prepare(effect('clarity-v1', { amount: 50 }), descriptor());
	const hostile = { descriptor: descriptor(2), get pixels(): Float32Array<ArrayBuffer> { probes++; return assert.fail('Metadata must precede pixel reflection.'); } };
	await assert.rejects(write({ ...pass }, hostile, new Float32Array(8)), /owning|prepared|identity/u);
	await assert.rejects(write(pass, hostile, new Float32Array(8)), /descriptor/u);
	const revoked = Proxy.revocable({}, {}); revoked.revoke(); assert.equal(isPrepared(revoked.proxy), false); assert.throws(() => read(revoked.proxy), TypeError);
	assert.equal(probes, 0);
});

test('spatial profile admission stays native and closed before any pixel-bearing request exists', () => {
	for (const selected of [effect('other-v1'), effect('grain-v1', { seed: 65521 }), effect('detail-sharpen-v1', { threshold: 256 })]) {
		assert.throws(() => prepare(selected, descriptor()));
	}
	for (const invalid of [{ ...descriptor(), sampleFormat: 'unorm16' as const }, { ...descriptor(), transfer: 'srgb' as const },
		{ ...descriptor(), primaries: 'display-p3' as const }, { ...descriptor(), width: 8193 }, { ...descriptor(), width: 8192, height: 8192 }]) {
		assert.throws(() => prepare(effect('clarity-v1', { amount: 50 }), invalid));
	}
	const largestSeed = prepare(effect('grain-v1', { amount: 100, seed: 65520 }), descriptor());
	assert.equal(largestSeed.params0[3], 65520); assert.equal(largestSeed.supported, true);
});

test('native plane aliasing and padded backings remain refused by the unchanged CPU writer', async () => {
	const input = source(), before = input.pixels.slice(), pass = prepare(effect('grain-v1', { amount: 50 }), input.descriptor);
	await assert.rejects(write(pass, input, input.pixels), /separate|disjoint/u);
	const padded = new Float32Array(new ArrayBuffer(input.pixels.byteLength + 16), 0, input.pixels.length);
	padded.set(input.pixels); await assert.rejects(write(pass, { descriptor: input.descriptor, pixels: padded }, new Float32Array(input.pixels.length)), /dedicated|backing/u);
	assert.deepEqual(input.pixels, before);
});

test('opaque pre-abort precedes private identity and hostile frame reflection', async () => {
	const stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); stop.abort(opaque.proxy);
	let probes = 0;
	const hostile = { descriptor: descriptor(), get pixels(): Float32Array<ArrayBuffer> { probes++; return assert.fail('Pre-abort must win.'); } };
	const result = await write(opaque.proxy, hostile, new Float32Array(12), stop.signal).then(() => ({ success: true }), (error: unknown) => ({ error }));
	assert.ok('error' in result); assert.equal(result.error, opaque.proxy); assert.equal(probes, 0);
});

test('real task cancellation joins the native write and retains opaque failure without mutating its source', async () => {
	const extent = descriptor(128, 128), pixels = new Float32Array(128 * 128 * 4);
	for (let at = 0; at < pixels.length; at += 4) pixels.set([.25, .5, .75, 1], at);
	const before = pixels.slice(), input = { descriptor: extent, pixels }, target = new Float32Array(pixels.length).fill(4);
	const pass = prepare(effect('clarity-v1', { amount: 100 }), extent), stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
	const timer = setTimeout(() => stop.abort(reason.proxy), 0);
	try {
		const result = await write(pass, input, target, stop.signal).then(() => ({ success: true }), (error: unknown) => ({ error }));
		assert.ok('error' in result); assert.equal(result.error, reason.proxy); assert.notEqual(target[0], 4); assert.equal(target[target.length - 1], 4);
		assert.deepEqual(pixels, before);
	} finally { clearTimeout(timer); }
});

test('native output overflow stays a fatal CPU error rather than a shader-support refusal', async () => {
	const pixels = Float32Array.of(0, 0, 0, 1, Math.fround(3.4028234663852886e38), 0, 0, 1, 0, 0, 0, 1), before = pixels.slice();
	const pass = prepare(effect('detail-sharpen-v1', { amount: 200 }), descriptor());
	assert.equal(pass.supported, true);
	await assert.rejects(write(pass, { descriptor: descriptor(), pixels }, new Float32Array(pixels.length)), /finite|Float32/u);
	assert.deepEqual(pixels, before);
});
