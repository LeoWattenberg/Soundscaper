/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePixelFrameWebGl2ReferenceCurrentV1 as validate } from '../src/common/editor/imaging/pixel-frame-webgl2-reference-current-v1.ts';
import { preparePixelFrameWebGl2SpatialCurrentV1 as spatialPass } from '../src/common/editor/imaging/pixel-frame-webgl2-spatial-current-v1.ts';
import { preparePixelFrameWebGl2OpticsCurrentV1 as opticsPass } from '../src/common/editor/imaging/pixel-frame-webgl2-optics-current-v1.ts';
import { preparePixelFrameWebGl2GeometryCurrentV1 as geometryPass } from '../src/common/editor/imaging/pixel-frame-webgl2-geometry-current-v1.ts';
import { prepareLinearSpatialEffectV1, writeLinearSpatialEffectV1 } from '../src/common/editor/imaging/pixel-frame-linear-spatial-v1.ts';
import { prepareLinearChromaticAberrationV1, writeLinearChromaticAberrationV1 } from '../src/common/editor/imaging/pixel-frame-linear-chromatic-aberration-v1.ts';
import { prepareLinearOpticalVignetteV1, writeLinearOpticalVignetteV1 } from '../src/common/editor/imaging/pixel-frame-linear-optical-vignette-v1.ts';
import { prepareLinearGeometryV1, writeLinearGeometryV1 } from '../src/common/editor/imaging/pixel-frame-linear-geometry-v1.ts';
import { LINEAR_KERNEL_LIMITS_V1 } from '../src/common/editor/imaging/linear-kernel-descriptor-v1.ts';
import { LinearDevelopOwnerV1 } from '../src/common/editor/imaging/image-develop-linear-owner-v1.ts';
import type { LinearWorkingPixelFrameV1 } from '../src/common/editor/imaging/image-develop-linear-frame-v1.ts';

const check = () => {};
const effect = (type: string, params: Readonly<Record<string, unknown>> = {}, enabled = true) => ({ id: type, type, enabled, params });
const descriptor = (width: number, height = 1) => ({ schemaVersion: 1 as const, width, height,
	sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const });
const frame = (width: number, values: ArrayLike<number>, height = 1): LinearWorkingPixelFrameV1 => ({ descriptor: descriptor(width, height), pixels: Float32Array.from(values) });
const encode = (value: number) => Math.sign(value) * (Math.abs(value) <= .0031308 ? Math.abs(value) * 12.92 : 1.055 * Math.abs(value) ** (1 / 2.4) - .055);
const decode = (value: number) => Math.sign(value) * (Math.abs(value) <= .04045 ? Math.abs(value) / 12.92 : ((Math.abs(value) + .055) / 1.055) ** 2.4);
function shifted(value: number, ulps: number): number {
	const sample = Float32Array.of(value), bits = new Uint32Array(sample.buffer); bits[0] = bits[0]! + ulps; return sample[0]!;
}
async function nativeSpatial(source: LinearWorkingPixelFrameV1, value: ReturnType<typeof effect>): Promise<LinearWorkingPixelFrameV1> {
	const plan = prepareLinearSpatialEffectV1(value, source.descriptor), pixels = new Float32Array(source.pixels.length);
	assert.equal(plan.scratchBytes, 0); await writeLinearSpatialEffectV1(plan, source.pixels, pixels, new Uint8Array(0));
	return { descriptor: source.descriptor, pixels };
}
async function nativeCa(source: LinearWorkingPixelFrameV1, value: ReturnType<typeof effect>): Promise<LinearWorkingPixelFrameV1> {
	const plan = prepareLinearChromaticAberrationV1(value.params.red, value.params.blue, source.descriptor, LINEAR_KERNEL_LIMITS_V1);
	const pixels = new Float32Array(source.pixels.length); await writeLinearChromaticAberrationV1(plan, source, pixels);
	return { descriptor: source.descriptor, pixels };
}
const neighborhoods = [effect('detail-sharpen-v1', { amount: 50 }), effect('clarity-v1', { amount: 50 }),
	effect('noise-reduction-v1', { luminance: 50, color: 50 }), effect('texture-v1', { amount: 50 }), effect('dehaze-v1', { amount: 50 })];

test('a genuine native neighborhood correction can round back to Original without proving same-pixel ancestry', async () => {
	const low = shifted(.25, -1), source = frame(3, [low, low, low, 1, .25, .25, .25, 1, low, low, low, 1]);
	const value = effect('detail-sharpen-v1', { amount: .5, threshold: 0 }), native = prepareLinearSpatialEffectV1(value, source.descriptor);
	assert.equal(native.neutral, false); assert.equal(spatialPass(value, source.descriptor).params0[0], 1);
	// The vertical weights cancel on this one-row input. The horizontal
	// binomial mean is (left + 2*center + right)/4 in continuous encoded RGB.
	const center = encode(source.pixels[4]!), mean = (encode(low) + 2 * center + encode(low)) / 4;
	const corrected = decode(center + (center - mean) / 256);
	assert.ok(center > mean); assert.ok(corrected > source.pixels[4]!);
	assert.equal(Object.is(Math.fround(corrected), source.pixels[4]), true);
	const expected = await nativeSpatial(source, value), pass = spatialPass(value, source.descriptor);
	assert.equal(Object.is(expected.pixels[4], Math.fround(corrected)), true);
	assert.equal(await validate(source, expected, [pass], check), true);
	const result = frame(3, expected.pixels); result.pixels[4] = shifted(expected.pixels[4]!, 1);
	assert.equal(await validate(source, result, [pass], check), true,
		'An actual neighborhood computation cannot inherit Original ancestry from a rounded coincidence.');
});

test('every active neighborhood clears Original coincidence while disabled and Q8-neutral stages keep exact copied components', async () => {
	const source = frame(3, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
	for (const value of neighborhoods) {
		const expected = await nativeSpatial(source, value); assert.deepEqual(expected.pixels, source.pixels);
		const result = frame(3, expected.pixels); result.pixels[5] = shifted(1, 1);
		assert.equal(await validate(source, result, [spatialPass(value, source.descriptor)], check), true, value.type);
		const params = value.type === 'noise-reduction-v1' ? { luminance: .1, color: .1 } : { amount: .1 };
		for (const copy of [{ ...value, enabled: false }, effect(value.type, params)]) {
			assert.equal(await validate(source, source, [spatialPass(copy, source.descriptor)], check), true);
			assert.equal(await validate(source, result, [spatialPass(copy, source.descriptor)], check), false,
				`${value.type}: a copied component retains its exact Original guard.`);
		}
	}
});

test('CA → coupled spatial stages propagate either reconstructed channel to Green without restoring ancestry', async () => {
	for (const active of ['red', 'blue'] as const) {
		const source = frame(3, [2, 1, 2, 1, 3, 1, 3, 1, 4, 1, 4, 1]);
		const ca = effect('chromatic-aberration-v1', { red: active === 'red' ? -100 : 0, blue: active === 'blue' ? -100 : 0 });
		const corrected = await nativeCa(source, ca), caPass = opticsPass(ca, source.descriptor), channel = active === 'red' ? 0 : 2;
		assert.ok(corrected.pixels[channel]! > source.pixels[channel]!); assert.equal(corrected.pixels[1], 1);
		for (const value of [effect('grain-v1', { amount: 50, seed: 23 }),
			effect('post-crop-vignette-v1', { amount: -100, midpoint: 0, feather: 0, highlights: 100 })]) {
			const expected = await nativeSpatial(corrected, value), result = frame(3, expected.pixels);
			assert.equal(expected.pixels[1], 1, 'The HDR protection/response makes this a genuine final-value coincidence.');
			result.pixels[1] = shifted(1, 1);
			assert.equal(await validate(source, result, [caPass, spatialPass(value, source.descriptor)], check), true, `${active}: ${value.type}`);
			const direct = await nativeSpatial(source, value), directResult = frame(3, direct.pixels); directResult.pixels[1] = shifted(1, 1);
			assert.equal(await validate(source, directResult, [spatialPass(value, source.descriptor)], check), false,
				'Coupling propagates a prior invalidation; it cannot manufacture one for an unchanged same-pixel witness.');
		}
		for (const value of [effect('dehaze-v1', { amount: -100 }), effect('post-crop-vignette-v1', { amount: 50, midpoint: 0, feather: 0 })]) {
			const expected = await nativeSpatial(corrected, value), result = frame(3, expected.pixels); assert.equal(expected.pixels[1], 1);
			result.pixels[1] = shifted(1, 1);
			assert.equal(await validate(source, result, [caPass, spatialPass(value, source.descriptor)], check), false,
				`${active}: independent ${value.type} retains the copied Green guard.`);
		}
	}
});

test('all seven spatial families use incoming Float32 planes among optics and changing geometry', async () => {
	const source = frame(3, [.125, .25, .5, 1, .25, .5, .75, .5, .75, .125, .25, 1,
		.5, .75, .125, 1, .125, .25, .75, 1, .75, .5, .25, .5, .25, .125, .5, 1, .5, .25, .75, 1, -0, 1e-30, 2, 0], 3);
	const before = source.pixels.slice(), values = [neighborhoods[0]!, effect('post-crop-vignette-v1', { amount: -25, highlights: 25 }),
		neighborhoods[1]!, neighborhoods[2]!, effect('grain-v1', { amount: 25, seed: 23 }), neighborhoods[3]!, neighborhoods[4]!];
	const ca = effect('chromatic-aberration-v1', { red: -70, blue: 30 }), passes: unknown[] = [opticsPass(ca, source.descriptor)];
	let expected = await nativeCa(source, ca);
	for (let index = 0; index < values.length; index++) {
		const value = values[index]!; passes.push(spatialPass(value, expected.descriptor)); expected = await nativeSpatial(expected, value);
		if (index === 2) {
			const geometry = { schemaVersion: 1 as const, crop: { x: 0, y: 0, width: 2 / 3, height: 1 }, rotationDegrees: 90,
				flipHorizontal: false, flipVertical: false, perspective: null };
			passes.push(geometryPass(geometry, expected.descriptor));
			const plan = prepareLinearGeometryV1(geometry, expected.descriptor, LINEAR_KERNEL_LIMITS_V1), pixels = new Float32Array(plan.sampleCount);
			await writeLinearGeometryV1(plan, expected, pixels); expected = { descriptor: plan.descriptor, pixels };
		}
		if (index === 4) {
			const optical = effect('optical-vignette-v1', { amount: 25 }), pixels = new Float32Array(expected.pixels.length);
			passes.push(opticsPass(optical, expected.descriptor));
			await writeLinearOpticalVignetteV1(prepareLinearOpticalVignetteV1(optical, expected.descriptor, LINEAR_KERNEL_LIMITS_V1), expected, pixels);
			expected = { descriptor: expected.descriptor, pixels };
		}
	}
	assert.deepEqual([expected.descriptor.width, expected.descriptor.height], [3, 2]);
	assert.equal(await validate(source, expected, passes, check), true);
	const wrong = frame(3, expected.pixels, 2); wrong.pixels[0] = shifted(expected.pixels[0]!, 32);
	assert.equal(await validate(source, wrong, passes, check), false); assert.deepEqual(source.pixels, before);
});

test('a complete spatial descriptor chain and owning identities are admitted before either pixel property', async () => {
	let probes = 0;
	const hostile = { descriptor: descriptor(3), get pixels(): Float32Array<ArrayBuffer> { probes++; return assert.fail('Metadata before pixels.'); } };
	const pass = spatialPass(effect('clarity-v1', { amount: 50 }), descriptor(3));
	await assert.rejects(validate(hostile, hostile, [{ ...pass }], check), /owning|identity|prepared/u);
	const other = spatialPass(effect('grain-v1', { amount: 50 }), descriptor(2));
	await assert.rejects(validate(hostile, hostile, [pass, other], check), /descriptor|binding|chain/u);
	const wrongOutput = { descriptor: descriptor(1), get pixels(): Float32Array<ArrayBuffer> { probes++; return assert.fail('Output descriptor before pixels.'); } };
	await assert.rejects(validate(hostile, wrongOutput, [pass], check), /descriptor/u);
	assert.equal(probes, 0);
});

test('spatial reference keeps two oracle planes, joins opaque cancellation and refuses physical borrowed detachment with full wipe', async t => {
	const allocate = LinearDevelopOwnerV1.prototype.floats, retire = LinearDevelopOwnerV1.prototype.retire;
	const owned: Float32Array<ArrayBuffer>[] = [], live = new Set<ArrayBuffer>(); let peak = 0, fault: 'none' | 'abort' | 'source' | 'result' = 'none';
	const stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	let source = frame(3, [.25, .5, .75, 1, .5, .75, .25, .5, -.25, -0, 2, 0]), result = source;
	t.mock.method(LinearDevelopOwnerV1.prototype, 'floats', function (this: LinearDevelopOwnerV1, length: number) {
		const plane = allocate.call(this, length); owned.push(plane); live.add(plane.buffer); peak = Math.max(peak, live.size);
		if (fault !== 'none' && live.size === 2) {
			if (fault === 'abort') stop.abort(opaque.proxy);
			else { const buffer = fault === 'source' ? source.pixels.buffer : result.pixels.buffer; structuredClone(buffer, { transfer: [buffer] }); }
		}
		return plane;
	});
	t.mock.method(LinearDevelopOwnerV1.prototype, 'retire', function (this: LinearDevelopOwnerV1, buffer: ArrayBuffer) { retire.call(this, buffer); live.delete(buffer); });
	const values = [effect('clarity-v1', { amount: 50 }), effect('texture-v1', { amount: -25 }), effect('grain-v1', { amount: 25, seed: 23 })];
	let expected = source;
	for (const value of values) expected = await nativeSpatial(expected, value);
	const passes = values.map(value => spatialPass(value, source.descriptor)); result = expected;
	assert.equal(await validate(source, result, passes, check), true); assert.equal(live.size, 0); assert.equal(peak, 2);
	for (const failure of ['source', 'result', 'abort'] as const) {
		fault = failure; source = frame(3, [.25, .5, .75, 1, .5, .75, .25, .5, -.25, -0, 2, 0]); result = frame(3, expected.pixels);
		const beforeSource = source.pixels.slice(), beforeResult = result.pixels.slice();
		const outcome = await validate(source, result, passes, check, undefined, stop.signal).then(() => ({ success: true }), (error: unknown) => ({ error }));
		assert.ok('error' in outcome);
		if (failure === 'abort') assert.equal(outcome.error, opaque.proxy);
		else assert.ok(outcome.error instanceof TypeError && /detach|changed/u.test(outcome.error.message));
		if (failure !== 'source') assert.deepEqual(source.pixels, beforeSource);
		if (failure !== 'result') assert.deepEqual(result.pixels, beforeResult);
		assert.equal(live.size, 0); assert.equal(peak, 2);
		for (const plane of owned) assert.ok(new Uint8Array(plane.buffer).every(value => value === 0));
	}
});

test('native spatial overflow stays fatal and retires both normative planes before rejection', async t => {
	const allocate = LinearDevelopOwnerV1.prototype.floats, owned: Float32Array<ArrayBuffer>[] = [];
	t.mock.method(LinearDevelopOwnerV1.prototype, 'floats', function (this: LinearDevelopOwnerV1, length: number) {
		const plane = allocate.call(this, length); owned.push(plane); return plane;
	});
	const source = frame(3, [0, 0, 0, 1, Math.fround(3.4028234663852886e38), 0, 0, 1, 0, 0, 0, 1]), before = source.pixels.slice();
	const pass = spatialPass(effect('detail-sharpen-v1', { amount: 200 }), source.descriptor);
	await assert.rejects(validate(source, source, [pass], check), /finite|Float32/u);
	assert.equal(owned.length, 2); for (const plane of owned) assert.ok(new Uint8Array(plane.buffer).every(value => value === 0));
	assert.deepEqual(source.pixels, before);
});
