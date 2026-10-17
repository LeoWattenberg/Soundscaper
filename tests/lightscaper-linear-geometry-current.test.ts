/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	prepareLinearGeometryV1,
	writeLinearGeometryV1,
} from '../src/common/editor/imaging/pixel-frame-linear-geometry-v1.ts';
import type { LinearWorkingPixelFrameV1 } from '../src/common/editor/imaging/image-develop-linear-frame-v1.ts';
import type { PixelFrameDescriptorV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';

const LIMITS = Object.freeze({ maximumSidePixels: 1024, maximumPixels: 1024 * 1024, maximumBytes: 16 * 1024 * 1024 });
const geometry = () => ({ schemaVersion: 1 as const, crop: null, rotationDegrees: 0,
	flipHorizontal: false, flipVertical: false, perspective: null });
const legacy = () => ({ crop: null, rotationDegrees: 0, flipHorizontal: false, flipVertical: false });
function descriptor(width: number, height: number): LinearWorkingPixelFrameV1['descriptor'] {
	return { schemaVersion: 1, width, height, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' };
}
function frame(width: number, height: number, pixels: Float32Array<ArrayBuffer>): LinearWorkingPixelFrameV1 {
	return { descriptor: descriptor(width, height), pixels };
}
const rgba = (...values: number[]) => Float32Array.from(values.flatMap(value => [value, value + 0.125, -value, 1]));
async function render(source: LinearWorkingPixelFrameV1, value: unknown = geometry()) {
	const plan = prepareLinearGeometryV1(value, source.descriptor, LIMITS);
	const pixels = new Float32Array(plan.sampleCount).fill(99);
	await writeLinearGeometryV1(plan, source, pixels);
	return { descriptor: plan.descriptor, pixels };
}
function near(actual: number, expected: number, tolerance = 0.00001): void {
	assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('linear crop preserves signed HDR and subbyte samples without touching source', async () => {
	const source = frame(4, 2, rgba(-2, 1 / 65535, 4, 8, -8, 1 / 1024, 3, 7)), before = source.pixels.slice();
	const plan = prepareLinearGeometryV1({ ...legacy(), crop: { x: 0.25, y: 0, width: 0.5, height: 1 } }, source.descriptor, LIMITS);
	assert.equal(plan.descriptor.width, 2); assert.equal(plan.descriptor.height, 2);
	assert.equal(plan.byteLength, 64); assert.equal(plan.sampleCount, 16);
	assert.equal(Object.isFrozen(plan), true); assert.equal(Object.isFrozen(plan.descriptor), true);
	const target = new Float32Array(plan.sampleCount).fill(19);
	await writeLinearGeometryV1(plan, source, target);
	assert.deepEqual(target, rgba(1 / 65535, 4, 1 / 1024, 3));
	assert.deepEqual(source.pixels, before);
});

test('linear clockwise rotations and output-axis flips use the existing independent geometry orders', async () => {
	const source = frame(2, 2, rgba(-2, 0.0001, 3, 8));
	for (const [value, expected] of [
		[{ ...geometry(), rotationDegrees: 90 }, rgba(3, -2, 8, 0.0001)],
		[{ ...geometry(), rotationDegrees: -90 }, rgba(0.0001, 8, -2, 3)],
		[{ ...geometry(), rotationDegrees: 180 }, rgba(8, 3, 0.0001, -2)],
		[{ ...geometry(), rotationDegrees: 90, flipHorizontal: true }, rgba(-2, 3, 0.0001, 8)],
		[{ ...geometry(), rotationDegrees: 90, flipVertical: true }, rgba(8, 0.0001, 3, -2)],
	] as const) assert.deepEqual((await render(source, value)).pixels, expected);
});

test('premultiplied interpolation retains tiny visible alpha and signed straight RGB while excluding hidden RGB', async () => {
	const tiny = Math.fround(0.000001), source = frame(2, 1, new Float32Array([100, -100, 8, 0, -2, 4, 1 / 65535, tiny]));
	const output = await render(source, { ...geometry(), crop: { x: 0.25, y: 0, width: 0.5, height: 1 } });
	assert.deepEqual(output.pixels, new Float32Array([-2, 4, 1 / 65535, tiny / 2]));
	const hidden = await render(frame(1, 1, new Float32Array([7, -4, 2, 0])));
	assert.deepEqual(hidden.pixels, new Float32Array(4));
	const underflow = await render(frame(2, 1, new Float32Array([0, 0, 0, 0, 4, -2, 1, 2 ** -149])),
		{ ...geometry(), crop: { x: 0.25, y: 0, width: 0.5, height: 1 } });
	assert.deepEqual(underflow.pixels, new Float32Array(4));
});

test('native perspective rectification has literal rational bilinear values and no byte quantization', async () => {
	const source = frame(2, 2, rgba(0, 100, 50, 150)), before = source.pixels.slice();
	const perspective = { topLeft: { x: 0, y: 0 }, topRight: { x: 1, y: 0 },
		bottomRight: { x: 0.75, y: 1 }, bottomLeft: { x: 0.25, y: 1 } };
	const output = await render(source, { ...geometry(), perspective });
	// At unit centers the homography maps ((u+v/2)/(1+v), 2v/(1+v)).
	for (const [index, red] of [25, 105, 500 / 7, 900 / 7].entries()) {
		near(output.pixels[index * 4]!, Math.fround(red));
		near(output.pixels[index * 4 + 1]!, Math.fround(red + 0.125));
		near(output.pixels[index * 4 + 2]!, Math.fround(-red));
		assert.equal(output.pixels[index * 4 + 3], 1);
	}
	assert.deepEqual(source.pixels, before);
});

test('non-quarter rotation clears reused target corners and preserves a fractional HDR center', async () => {
	const output = await render(frame(2, 2, rgba(-2, 0.125, 4, 8)), { ...geometry(), rotationDegrees: 45 });
	assert.equal(output.descriptor.width, 3); assert.equal(output.descriptor.height, 3);
	assert.deepEqual(output.pixels.slice(0, 4), new Float32Array(4));
	assert.deepEqual(output.pixels.slice(16, 20), rgba(2.53125));
});

test('preparation closes both geometry dialects and rejects invalid source/output profiles before pixel access', () => {
	const input = descriptor(2, 2);
	assert.throws(() => prepareLinearGeometryV1({ ...geometry(), extra: true }, input, LIMITS), /field|key|unexpected/u);
	assert.throws(() => prepareLinearGeometryV1({ ...legacy(), perspective: null }, input, LIMITS), /field|key|unexpected|schema/u);
	assert.throws(() => prepareLinearGeometryV1({ ...geometry(), crop: { x: 0.9, y: 0, width: 0.5, height: 1 } }, input, LIMITS), /crop/u);
	const point = { x: 0, y: 0 };
	assert.throws(() => prepareLinearGeometryV1({ ...geometry(), perspective: { topLeft: point, topRight: point, bottomLeft: point, bottomRight: point } }, input, LIMITS), /convex/u);
	for (const bad of [{ ...input, sampleFormat: 'unorm8' }, { ...input, transfer: 'srgb' }, { ...input, primaries: 'display-p3' }]) {
		assert.throws(() => prepareLinearGeometryV1(geometry(), bad as PixelFrameDescriptorV1, LIMITS), /linear|float|profile/u);
	}
	assert.throws(() => prepareLinearGeometryV1({ ...geometry(), rotationDegrees: 45 }, input, { ...LIMITS, maximumBytes: 64 }), /byte|limit/u);
	assert.throws(() => prepareLinearGeometryV1(geometry(), input, { ...LIMITS, maximumPixels: 3 }), /pixel|limit/u);
	let probes = 0;
	const accessor = { ...geometry(), get rotationDegrees() { probes++; throw new Error('geometry getter'); } };
	assert.throws(() => prepareLinearGeometryV1(accessor, input, LIMITS), /data|accessor/u); assert.equal(probes, 0);
});

test('writer authenticates plan, exact source descriptor, native target length and non-overlap before writing', async () => {
	const source = frame(2, 1, rgba(2, 3)), plan = prepareLinearGeometryV1(geometry(), source.descriptor, LIMITS);
	const target = new Float32Array(plan.sampleCount).fill(19);
	await assert.rejects(writeLinearGeometryV1({ ...plan }, source, target), /plan|prepared/u);
	await assert.rejects(writeLinearGeometryV1(plan, { ...source, descriptor: descriptor(1, 2) }, target), /descriptor|binding|geometry/u);
	await assert.rejects(writeLinearGeometryV1(plan, source, new Float32Array(4)), /length|sample|target|dedicated/u);
	await assert.rejects(writeLinearGeometryV1(plan, source, source.pixels), /overlap|alias|separate/u);
	const padded = new Float32Array(plan.sampleCount + 2).fill(23), view = padded.subarray(1, -1);
	await assert.rejects(writeLinearGeometryV1(plan, source, view), /dedicated/u);
	await assert.rejects(writeLinearGeometryV1(plan, { ...source, pixels: view }, target), /dedicated/u);
	assert.deepEqual(padded, new Float32Array(plan.sampleCount + 2).fill(23));
	let probes = 0;
	const hostile = new Float32Array(8);
	Object.defineProperty(hostile, 'buffer', { get() { probes++; throw new Error('shadow'); } });
	await assert.rejects(writeLinearGeometryV1(plan, source, hostile), /shadow|intrinsic/u); assert.equal(probes, 0);
	assert.deepEqual(target, new Float32Array(plan.sampleCount).fill(19));
});

test('nonfinite RGB and invalid straight alpha refuse without publishing target samples', async () => {
	for (const values of [[NaN, 0, 0, 1], [Infinity, 0, 0, 1], [0, 0, 0, -0.1], [0, 0, 0, 1.1]]) {
		const source = frame(1, 1, new Float32Array(values)), target = new Float32Array(4).fill(9);
		const plan = prepareLinearGeometryV1(geometry(), source.descriptor, LIMITS);
		await assert.rejects(writeLinearGeometryV1(plan, source, target), /finite|alpha/u);
		assert.deepEqual(target, new Float32Array(4).fill(9));
	}
});

test('pre-abort preserves opaque identity before source, target or plan reflection', async () => {
	const stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); stop.abort(reason.proxy);
	let probes = 0;
	const hostile = new Proxy({}, { get() { probes++; throw new Error('get'); }, getOwnPropertyDescriptor() { probes++; throw new Error('own'); }, getPrototypeOf() { probes++; throw new Error('prototype'); } });
	const outcome = await writeLinearGeometryV1(hostile as ReturnType<typeof prepareLinearGeometryV1>, hostile as LinearWorkingPixelFrameV1,
		hostile as Float32Array<ArrayBuffer>, stop.signal).then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	assert.equal(outcome.ok, false); if (!outcome.ok) assert.equal(Object.is(outcome.error, reason.proxy), true);
	assert.equal(probes, 0);
});

test('writer yields bounded work, propagates cancellation and detects physical transfer of either caller plane', async () => {
	for (const mode of ['cancel', 'source-transfer', 'target-transfer'] as const) {
		const source = frame(512, 512, new Float32Array(512 * 512 * 4).fill(1)), target = new Float32Array(source.pixels.length);
		const plan = prepareLinearGeometryV1(geometry(), source.descriptor, LIMITS), stop = new AbortController(), reason = Object.freeze({ stopped: mode });
		const timer = setTimeout(() => {
			if (mode === 'cancel') stop.abort(reason);
			else { const buffer = mode === 'source-transfer' ? source.pixels.buffer : target.buffer; structuredClone(buffer, { transfer: [buffer] }); }
		}, 0);
		try {
			await assert.rejects(writeLinearGeometryV1(plan, source, target, stop.signal), error => mode === 'cancel'
				? Object.is(error, reason) : error instanceof TypeError && /detach|changed/u.test(error.message));
		} finally { clearTimeout(timer); }
	}
});
