/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { planImageLensDistortionV1, writeImageLensDistortionPointV1 } from '../src/common/editor/imaging/image-lens-distortion-plan-v1.ts';
import { withLensDistortionPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-lens-distortion-v1.ts';
import { prepareLinearLensDistortionV1, writeLinearLensDistortionV1 } from '../src/common/editor/imaging/pixel-frame-linear-lens-distortion-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const LIMITS = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 268_435_456 });
const BYTE = Object.freeze({ schemaVersion: 1, width: 3, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' } as const);
const LINEAR = Object.freeze({ ...BYTE, sampleFormat: 'float32', transfer: 'linear' } as const);
function bytes(values: readonly number[], width = values.length / 4): PixelFrameV1 {
	return { descriptor: { ...BYTE, width }, pixels: Uint8Array.from(values) };
}
function native(values: readonly number[], primaries: 'srgb' | 'bt709' = 'srgb') {
	return { descriptor: { ...LINEAR, width: values.length / 4, primaries }, pixels: Float32Array.from(values) };
}
function raw(frame: Readonly<PixelFrameV1>): Uint8Array<ArrayBuffer> {
	return new Uint8Array(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength);
}
function observed<Value>(work: Promise<Value>) {
	return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
function close(actual: number, expected: number) { assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} differs from ${expected}`); }
async function reached(work: Promise<unknown>, entered: Promise<void>) {
	await Promise.race([entered, work.then(() => assert.fail('Lens owner settled before its consumer.'), (error: unknown) => { throw error; })]);
}

test('Lens scalar mapping uses pixel centers, half-diagonal radius and the signed inverse radial coefficient', () => {
	const point = { x: 0, y: 0 }, positive = planImageLensDistortionV1(100, 6, 8), negative = planImageLensDistortionV1(-100, 6, 8);
	assert.ok(Object.isFrozen(positive)); assert.equal(positive.coefficient, .3); assert.equal(positive.neutral, false);
	writeImageLensDistortionPointV1(positive, 3, 4, point); assert.deepEqual(point, { x: 3, y: 4 });
	writeImageLensDistortionPointV1(positive, 0, 0, point); close(point.x, -.9); close(point.y, -1.2);
	writeImageLensDistortionPointV1(negative, 0, 0, point); close(point.x, .9); close(point.y, 1.2);
	writeImageLensDistortionPointV1(planImageLensDistortionV1(100, 4, 2), .5, .5, point); close(point.x, .275); close(point.y, .425);
	assert.equal(planImageLensDistortionV1(0, 4, 2).neutral, true);
	// dr_source/dr_output=1+3*k*r² remains positive over the whole aperture.
	close(1 + 3 * negative.coefficient, .1);
});

test('Lens scalar admission refuses nonfinite amount, out-of-range amount and excessive source geometry', () => {
	for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, -100.01, 100.01, '0', null]) {
		assert.throws(() => planImageLensDistortionV1(amount, 3, 1));
	}
	for (const [width, height] of [[0, 1], [1.5, 1], [65_537, 1], [65_536, 1025]]) {
		assert.throws(() => planImageLensDistortionV1(0, width!, height!), RangeError);
	}
});

test('Lens scalar coordinate planning admits existing large natural byte extents without allocating pixels', () => {
	for (const [width, height] of [[16_384, 4096], [65_536, 1024]] as const) {
		const plan = planImageLensDistortionV1(-100, width, height), point = { x: 0, y: 0 };
		assert.equal(plan.width, width); assert.equal(plan.height, height);
		writeImageLensDistortionPointV1(plan, width / 2, height / 2, point);
		assert.deepEqual(point, { x: width / 2, y: height / 2 });
	}
});

test('Byte lens accepts an actually rendered 9000-pixel natural aspect under its caller profile', async () => {
	const width = 9000, source = bytes(Array.from({ length: width }, () => [7, 11, 19, 255]).flat()), before = raw(source).slice();
	const actual = await withLensDistortionPixelFrameV1({ frame: source, amount: 100 }, frame => [...frame.pixels],
		{ limits: { maximumSidePixels: 65_536, maximumPixels: 67_108_864, maximumBytes: 268_435_456 } });
	const expected: number[] = [];
	for (let x = 0; x < width; x++) {
		const dx = x + .5 - 4500, from = 4500 + dx * (1 + .3 * dx * dx / (4500 * 4500 + .25)) - .5;
		const left = Math.floor(from), fraction = from - left;
		const alpha = Math.round(255 * ((left >= 0 && left < width ? 1 - fraction : 0) + (left + 1 >= 0 && left + 1 < width ? fraction : 0)));
		expected.push(...(alpha ? [7, 11, 19, alpha] : [0, 0, 0, 0]));
	}
	assert.deepEqual(actual, expected); assert.deepEqual(raw(source), before);
});

test('Byte lens positive radial warp zero-extends each bilinear tap instead of clamping the image edge', async () => {
	const source = bytes([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]), before = raw(source).slice();
	let backing: Uint8Array<ArrayBuffer> | undefined;
	const value = await withLensDistortionPixelFrameV1({ frame: source, amount: 100 }, frame => {
		assert.deepEqual(frame.descriptor, source.descriptor); backing = raw(frame); return [...frame.pixels];
	}, { limits: LIMITS });
	// Edge centers map0.5→0.38 and2.5→2.62. Their outside taps carry0.12
	// transparent weight; straight RGB survives, alpha rounds0.88*255→224.
	assert.deepEqual(value, [255, 0, 0, 224, 0, 255, 0, 255, 0, 0, 255, 224]);
	assert.ok(backing?.every(value => value === 0)); assert.deepEqual(raw(source), before);
});

test('Byte lens negative amount has an independent three-pixel interpolation literal', async () => {
	const source = bytes([0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255]);
	assert.deepEqual(await withLensDistortionPixelFrameV1({ frame: source, amount: -100 }, frame => [...frame.pixels], { limits: LIMITS }),
		[12, 12, 12, 255, 100, 100, 100, 255, 188, 188, 188, 255]);
});

test('Byte lens interpolates premultiplied encoded RGB and excludes hidden transparent color', async () => {
	const source = bytes([200, 50, 0, 255, 0, 250, 100, 0, 0, 100, 200, 255]);
	assert.deepEqual(await withLensDistortionPixelFrameV1({ frame: source, amount: -100 }, frame => [...frame.pixels], { limits: LIMITS }),
		[200, 50, 0, 224, 0, 0, 0, 0, 0, 100, 200, 224]);
});

for (const primaries of ['srgb', 'bt709'] as const) test(`Native lens filters signed/HDR ${primaries} directly in premultiplied linear Float32`, async () => {
	const source = native([2, -.5, .125, 1, 0, 1, 4, .5, 8, 2, -2, 0], primaries), before = raw(source).slice();
	const plan = prepareLinearLensDistortionV1(-100, source.descriptor, LIMITS), target = new Float32Array(source.pixels.length);
	assert.equal(plan.scratchBytes, 0); assert.equal(plan.byteLength, 48); assert.ok(Object.isFrozen(plan));
	await writeLinearLensDistortionV1(plan, source, target);
	// Left weights0.88 and0.12 give alpha0.94. Premultiplied RGB sums
	// [1.76,-0.38,0.35], so the exact rational straight channels are below.
	assert.deepEqual([...target], [...Float32Array.from([88 / 47, -19 / 47, 35 / 94, .94, 0, 1, 4, .5, 0, 1, 4, .06])]);
	assert.ok(target[0]! > 1); assert.ok(target[1]! < 0); assert.deepEqual(raw(source), before);
});

test('Native positive warp preserves fractional alpha and canonicalizes only filtered zero-alpha color', async () => {
	const source = native([2, -.5, 1e-30, .5, 3, 4, 5, 1, 100, -100, 8, 0]);
	const target = new Float32Array(12), plan = prepareLinearLensDistortionV1(100, source.descriptor, LIMITS);
	await writeLinearLensDistortionV1(plan, source, target);
	assert.deepEqual([...target], [...Float32Array.from([2, -.5, 1e-30, .44, 3, 4, 5, 1, 0, 0, 0, 0])]);
});

test('Neutral lens copies exact byte and native hidden RGB, negative zero and subnormal bits without filtering', async () => {
	const source = bytes([1, 127, 254, 0, 20, 30, 40, 255, 80, 90, 100, 1]);
	assert.deepEqual(await withLensDistortionPixelFrameV1({ frame: source, amount: 0 }, frame => raw(frame).slice(), { limits: LIMITS }), raw(source));
	const full = native([-0, -.25, 4, 0, 2 ** -149, -(2 ** -149), 1e-30, 1]), before = raw(full).slice();
	const target = new Float32Array(full.pixels.length), plan = prepareLinearLensDistortionV1(0, full.descriptor, LIMITS);
	await writeLinearLensDistortionV1(plan, full, target);
	assert.equal(plan.neutral, true); assert.ok(Object.is(target[0], -0)); assert.deepEqual(new Uint8Array(target.buffer), before); assert.deepEqual(raw(full), before);
});

test('Byte lens amount, geometry and output capacity admission precede every raw pixel descriptor', async () => {
	for (const [amount, descriptor, limits] of [[101, BYTE, LIMITS], [0, { ...BYTE, width: 8193 }, LIMITS],
		[0, BYTE, { ...LIMITS, maximumBytes: 11 }]] as const) {
		let reads = 0;
		const marker = Symbol('pixel-authority'), frame = new Proxy({ descriptor, pixels: undefined }, {
			getOwnPropertyDescriptor(target, key) { if (key === 'pixels') { reads++; throw marker; } return Reflect.getOwnPropertyDescriptor(target, key); },
		});
		const settled = await observed(withLensDistortionPixelFrameV1({ frame, amount }, () => assert.fail('Invalid lens metadata delivered.'), { limits }));
		if (settled.ok) assert.fail('Invalid lens metadata was admitted.');
		assert.equal(reads, 0); assert.ok(settled.error instanceof RangeError);
	}
});

test('Native lens rejects forged plans, descriptor drift, aliasing and padded/shared/resizable source planes before writes', async () => {
	const source = native([2, -.5, .125, 1]), plan = prepareLinearLensDistortionV1(-100, source.descriptor, LIMITS), target = Float32Array.of(9, 9, 9, 9);
	await assert.rejects(writeLinearLensDistortionV1({ ...plan }, source, target), TypeError);
	await assert.rejects(writeLinearLensDistortionV1(plan, { ...source, descriptor: { ...source.descriptor, primaries: 'bt709' } }, target), RangeError);
	await assert.rejects(writeLinearLensDistortionV1(plan, source, source.pixels), TypeError);
	const resizable = Reflect.construct(ArrayBuffer, [16, { maxByteLength: 32 }]) as ArrayBuffer;
	for (const pixels of [new Float32Array(new ArrayBuffer(32), 0, 4), new Float32Array(new SharedArrayBuffer(16)), new Float32Array(resizable)]) {
		await assert.rejects(writeLinearLensDistortionV1(plan, { ...source, pixels }, target));
	}
	assert.deepEqual([...target], [9, 9, 9, 9]); assert.deepEqual([...source.pixels], [2, -.5, .125, 1]);
});

test('Byte lens physical padded-backing admission uses intrinsic source bytes before allocating output', async () => {
	const buffer = new ArrayBuffer(512 * 1024 * 1024), pixels = new Uint8Array(buffer, 0, 4); pixels.set([1, 2, 3, 255]);
	Object.defineProperty(buffer, 'byteLength', { value: 4 });
	const frame = { descriptor: { ...BYTE, width: 1 }, pixels };
	await assert.rejects(withLensDistortionPixelFrameV1({ frame, amount: 0 }, () => assert.fail('Physical lens budget exceeded.'), { limits: LIMITS }), /physical|working|budget/u);
	assert.deepEqual([...pixels], [1, 2, 3, 255]);
});

test('Byte lens joins held consumer cancellation before wiping its dedicated output and retains exact opaque reason', async () => {
	const source = bytes([0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255]), before = raw(source).slice();
	const stop = new AbortController(), revoked = Proxy.revocable({}, {}); revoked.revoke();
	const entered = deferred<void>(), release = deferred<void>(); let backing: Uint8Array<ArrayBuffer> | undefined;
	const work = withLensDistortionPixelFrameV1({ frame: source, amount: -100, signal: stop.signal }, async frame => {
		backing = raw(frame); entered.resolve(); await release.promise; assert.ok(backing.some(value => value !== 0)); return 'held';
	}, { limits: LIMITS }), result = observed(work);
	try {
		await reached(work, entered.promise); stop.abort(revoked.proxy); assert.equal(await remainsPending(work), true);
		assert.ok(backing?.some(value => value !== 0)); release.resolve();
		const settled = await result; if (settled.ok) assert.fail('Cancelled lens operation delivered.');
		assert.ok(Object.is(settled.error, revoked.proxy)); assert.ok(backing?.every(value => value === 0)); assert.deepEqual(raw(source), before);
	} finally { release.resolve(); await result; }
});

test('Byte lens preserves opaque primary and independent physical transfer cleanup failure even after abort', async () => {
	const source = bytes([1, 2, 3, 255]), before = raw(source).slice(), stop = new AbortController(), revoked = Proxy.revocable({}, {}); revoked.revoke();
	let transferred: ArrayBuffer | undefined;
	try {
		const settled = await observed(withLensDistortionPixelFrameV1({ frame: source, amount: 0, signal: stop.signal }, frame => {
			transferred = structuredClone(frame.pixels.buffer, { transfer: [frame.pixels.buffer] }); stop.abort(Symbol('later-abort')); throw revoked.proxy;
		}, { limits: LIMITS }));
		if (settled.ok) assert.fail('Unretired lens output delivered.');
		assert.ok(settled.error instanceof AggregateError); assert.ok(Object.is(settled.error.errors[0], revoked.proxy)); assert.ok(settled.error.errors[1] instanceof TypeError);
		assert.ok(transferred); assert.deepEqual(new Uint8Array(transferred), before); assert.deepEqual(raw(source), before);
	} finally { if (transferred) new Uint8Array(transferred).fill(0); }
});

test('Byte lens wipes pinned backing despite borrower geometry shadows and exact opaque failure', async () => {
	const source = bytes([1, 2, 3, 255]), revoked = Proxy.revocable({}, {}); revoked.revoke(); let backing: Uint8Array<ArrayBuffer> | undefined, reads = 0;
	const settled = await observed(withLensDistortionPixelFrameV1({ frame: source, amount: 0 }, frame => {
		backing = raw(frame);
		for (const name of ['buffer', 'byteLength', 'fill']) Object.defineProperty(frame.pixels, name, { get(): never { reads++; throw new Error('Untrusted wipe geometry.'); } });
		throw revoked.proxy;
	}, { limits: LIMITS }));
	if (settled.ok) assert.fail('Failed lens consumer delivered.');
	assert.ok(Object.is(settled.error, revoked.proxy)); assert.equal(reads, 0); assert.ok(backing?.every(value => value === 0));
});
