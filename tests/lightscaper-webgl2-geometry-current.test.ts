/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	preparePixelFrameWebGl2GeometryCurrentV1 as prepare,
	readPixelFrameWebGl2GeometryCurrentV1 as read,
	isPixelFrameWebGl2GeometryCurrentV1 as isGeometry,
	writePixelFrameWebGl2GeometryCurrentV1 as write,
} from '../src/common/editor/imaging/pixel-frame-webgl2-geometry-current-v1.ts';
import type { LinearWorkingPixelFrameV1 } from '../src/common/editor/imaging/image-develop-linear-frame-v1.ts';
import type { PixelFrameDescriptorV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';

const geometry = () => ({ schemaVersion: 1 as const, crop: null, rotationDegrees: 0,
	flipHorizontal: false, flipVertical: false, perspective: null });
function descriptor(width: number, height: number): LinearWorkingPixelFrameV1['descriptor'] {
	return { schemaVersion: 1, width, height, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' };
}
const frame = (width: number, height: number, pixels: Float32Array<ArrayBuffer>): LinearWorkingPixelFrameV1 => ({ descriptor: descriptor(width, height), pixels });
const rgba = (...values: number[]) => Float32Array.from(values.flatMap(value => [value, value + .125, -value, 1]));
async function render(source: LinearWorkingPixelFrameV1, value: unknown = geometry()) {
	const pass = prepare(value, source.descriptor), pixels = new Float32Array(pass.descriptor.width * pass.descriptor.height * 4).fill(19);
	await write(pass, source, pixels); return { pass, pixels };
}

test('GPU geometry metadata captures natural extent, exact crop bounds and deeply frozen scalar maps', () => {
	const input = { ...geometry(), crop: { x: .25, y: 0, width: .5, height: 1 }, rotationDegrees: 90 };
	const pass = prepare(input, descriptor(4, 2));
	assert.equal(read(pass), pass); assert.equal(isGeometry(pass), true); assert.equal(pass.type, 'develop-geometry-v1'); assert.equal(pass.kind, 9);
	assert.deepEqual(pass.sourceDescriptor, descriptor(4, 2)); assert.deepEqual(pass.descriptor, descriptor(2, 2));
	assert.deepEqual(pass.bounds, [1, 0, 2, 1]);
	assert.deepEqual(pass.mapping.outputToAperture, [0, .5, 0, -.5, 0, 1]);
	assert.deepEqual(pass.mapping.apertureToSource, [2, 0, 1, 0, 2, 0, 0, 0, 1]);
	for (const value of [pass, pass.sourceDescriptor, pass.descriptor, pass.mapping, pass.mapping.crop,
		pass.mapping.outputToAperture, pass.mapping.apertureToSource, pass.bounds, pass.integerTransform]) assert.equal(Object.isFrozen(value), true);
	input.rotationDegrees = 0; input.crop.x = 0;
	assert.deepEqual(pass.integerTransform, [0, 1, 1, -1, 0, 1]); assert.equal(pass.integerPermutation, true); assert.equal(pass.supported, true);
	assert.deepEqual(prepare({ ...geometry(), rotationDegrees: 45 }, descriptor(3, 2)).descriptor, descriptor(4, 4));
});

test('odd rectangular quarter turns and output-axis flips have exact integer inverse transforms', async () => {
	const source = frame(3, 5, rgba(...Array.from({ length: 15 }, (_, i) => i + 1)));
	for (const [change, transform, order] of [
		[{ rotationDegrees: 90 }, [0, 1, 0, -1, 0, 4], [13, 10, 7, 4, 1, 14, 11, 8, 5, 2, 15, 12, 9, 6, 3]],
		[{ rotationDegrees: -90 }, [0, -1, 2, 1, 0, 0], [3, 6, 9, 12, 15, 2, 5, 8, 11, 14, 1, 4, 7, 10, 13]],
		[{ rotationDegrees: 90, flipHorizontal: true }, [0, 1, 0, 1, 0, 0], [1, 4, 7, 10, 13, 2, 5, 8, 11, 14, 3, 6, 9, 12, 15]],
		[{ rotationDegrees: 90, flipVertical: true }, [0, -1, 2, -1, 0, 4], [15, 12, 9, 6, 3, 14, 11, 8, 5, 2, 13, 10, 7, 4, 1]],
	] as const) {
		const result = await render(source, { ...geometry(), ...change });
		assert.deepEqual(result.pass.descriptor, descriptor(5, 3)); assert.deepEqual(result.pass.integerTransform, transform);
		assert.equal(result.pass.integerPermutation, true); assert.deepEqual(result.pixels, rgba(...order));
	}
	const cropped = prepare({ ...geometry(), crop: { x: 1 / 3, y: .2, width: 2 / 3, height: .6 }, rotationDegrees: 90 }, source.descriptor);
	assert.deepEqual(cropped.descriptor, descriptor(3, 2)); assert.deepEqual(cropped.bounds, [1, 1, 2, 3]);
	assert.deepEqual(cropped.integerTransform, [0, 1, 1, -1, 0, 3]);
});

test('fractional crop and perspective retain rational native samples and disable integer permutations', async () => {
	const tiny = Math.fround(.000001), source = frame(2, 1, new Float32Array([100, -100, 8, 0, -2, 4, 1 / 65535, tiny]));
	const result = await render(source, { ...geometry(), crop: { x: .25, y: 0, width: .5, height: 1 } });
	assert.deepEqual(result.pixels, new Float32Array([-2, 4, 1 / 65535, tiny / 2]));
	assert.equal(result.pass.integerPermutation, false); assert.equal(result.pass.integerTransform, null);
	const perspective = { topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 }, bottomRight: { x: .75, y: 1 }, bottomLeft: { x: .25, y: 1 } };
	const rectified = await render(frame(2, 2, rgba(0, 100, 50, 150)), { ...geometry(), perspective });
	assert.equal(rectified.pass.integerPermutation, false); assert.equal(rectified.pass.integerTransform, null);
	assert.deepEqual(rectified.pixels, rgba(25, 105, 500 / 7, 900 / 7));
});

test('an authored identity geometry remains filtering: hidden RGB and signed zero canonicalize while visible HDR survives', async () => {
	const source = frame(3, 1, new Float32Array([7, -4, 2, 0, -0, -2, 4, 1, 2 ** -149, 1 / 65535, -3, .5])), before = source.pixels.slice();
	const result = await render(source);
	assert.equal(result.pass.integerPermutation, true); assert.deepEqual(result.pass.integerTransform, [1, 0, 0, 0, 1, 0]);
	assert.deepEqual(result.pixels, new Float32Array([0, 0, 0, 0, 0, -2, 4, 1, 2 ** -149, 1 / 65535, -3, .5]));
	assert.deepEqual(source.pixels, before);
	const underflow = await render(frame(2, 1, new Float32Array([0, 0, 0, 0, 4, -2, 1, 2 ** -149])),
		{ ...geometry(), crop: { x: .25, y: 0, width: .5, height: 1 } });
	assert.deepEqual(underflow.pixels, new Float32Array(4));
});

test('generic rotated corners clear reused output and a fractional center stays signed and unclipped', async () => {
	const result = await render(frame(2, 2, rgba(-2, .125, 4, 8)), { ...geometry(), rotationDegrees: 45 });
	assert.deepEqual(result.pass.descriptor, descriptor(3, 3)); assert.equal(result.pass.integerPermutation, false);
	assert.deepEqual(result.pixels.slice(0, 4), new Float32Array(4)); assert.deepEqual(result.pixels.slice(16, 20), rgba(2.53125));
});

test('metadata rejects invalid geometry and profiles before pixels and marks unusable Float32 mappings unsupported', () => {
	for (const bad of [{ ...descriptor(2, 2), sampleFormat: 'unorm16' }, { ...descriptor(2, 2), transfer: 'srgb' },
		{ ...descriptor(2, 2), primaries: 'display-p3' }]) assert.throws(() => prepare(geometry(), bad as PixelFrameDescriptorV1), /linear|float|profile/u);
	assert.throws(() => prepare({ ...geometry(), extra: true }, descriptor(2, 2)), /field/u);
	assert.throws(() => prepare({ ...geometry(), rotationDegrees: 45 }, descriptor(8192, 2048)), /limit|pixel|side/u);
	let probes = 0;
	const hostile = { ...geometry(), get crop() { probes++; throw new Error('pixel-free metadata getter'); } };
	assert.throws(() => prepare(hostile, descriptor(2, 2)), /data|accessor/u); assert.equal(probes, 0);
	const tiny = prepare({ ...geometry(), crop: { x: 0, y: 0, width: 1e-50, height: 1 } }, descriptor(2, 2));
	assert.equal(tiny.supported, false); assert.equal(tiny.integerTransform, null);
	const underflow = prepare({ ...geometry(), perspective: { topLeft: { x: 1e-50, y: 0 }, topRight: { x: 1, y: 0 },
		bottomRight: { x: 1, y: 1 }, bottomLeft: { x: 0, y: 1 } } }, descriptor(2, 2));
	assert.equal(underflow.supported, false);
});

test('private geometry identities reject clones and revoked objects without reflecting them', async () => {
	const source = frame(2, 1, rgba(2, 3)), pass = prepare(geometry(), source.descriptor), target = new Float32Array(8).fill(19);
	let probes = 0; const hostile = new Proxy({}, { get() { probes++; throw new Error('get'); }, getPrototypeOf() { probes++; throw new Error('prototype'); },
		getOwnPropertyDescriptor() { probes++; throw new Error('own'); } });
	const revoked = Proxy.revocable({}, {}); revoked.revoke();
	for (const value of [null, 1, { ...pass }, hostile, revoked.proxy]) { assert.equal(isGeometry(value), false); assert.throws(() => read(value), /prepared|owning|identity/u); }
	assert.equal(probes, 0); await assert.rejects(write({ ...pass }, source, target), /prepared|owning|identity/u);
	assert.deepEqual(target, new Float32Array(8).fill(19));
});

test('delegated CPU writer preserves exact descriptor, dedicated disjoint planes and caller custody', async () => {
	const source = frame(2, 1, rgba(-2, 4)), pass = prepare(geometry(), source.descriptor), target = new Float32Array(8).fill(19);
	await assert.rejects(write(pass, { ...source, descriptor: descriptor(1, 2) }, target), /descriptor|binding|geometry/u);
	await assert.rejects(write(pass, source, source.pixels), /overlap|alias|separate/u);
	await assert.rejects(write(pass, source, new Float32Array(10).subarray(1, 9)), /dedicated/u);
	assert.deepEqual(target, new Float32Array(8).fill(19)); await write(pass, source, target); assert.deepEqual(target, source.pixels);
});

test('pre-abort opaque identity wins before plan/source reflection and transfer remains caller-visible', async () => {
	const stop = new AbortController(), revoked = Proxy.revocable({}, {}); revoked.revoke(); stop.abort(revoked.proxy);
	const source = frame(1, 1, rgba(2)), pass = prepare(geometry(), source.descriptor), target = new Float32Array(4).fill(9);
	const outcome = await write(pass, source, target, stop.signal).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal(Object.is(outcome.error, revoked.proxy), true);
	assert.deepEqual(target, new Float32Array(4).fill(9));
	const detached = new Float32Array(4); structuredClone(detached.buffer, { transfer: [detached.buffer] });
	await assert.rejects(write(pass, source, detached), /detach|dedicated|length|target/u);
});

test('delegated geometry joins bounded yields and preserves cancellation or physical transfer failures', async () => {
	for (const mode of ['abort', 'source-transfer', 'target-transfer'] as const) {
		const source = frame(512, 512, new Float32Array(512 * 512 * 4).fill(1)), target = new Float32Array(source.pixels.length);
		const pass = prepare(geometry(), source.descriptor), stop = new AbortController(), revoked = Proxy.revocable({}, {}); revoked.revoke();
		const timer = setTimeout(() => {
			if (mode === 'abort') stop.abort(revoked.proxy);
			else { const buffer = mode === 'source-transfer' ? source.pixels.buffer : target.buffer; structuredClone(buffer, { transfer: [buffer] }); }
		}, 0);
		try {
			const result = await write(pass, source, target, stop.signal).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
			assert.equal(result.ok, false);
			if (!result.ok) {
				if (mode === 'abort') assert.equal(Object.is(result.error, revoked.proxy), true);
				else assert.ok(result.error instanceof TypeError && /detach|changed/u.test(result.error.message));
			}
		} finally { clearTimeout(timer); }
	}
});
