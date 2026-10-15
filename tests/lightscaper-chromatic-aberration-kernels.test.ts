/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { planImageChromaticAberrationV1 } from '../src/common/editor/imaging/image-chromatic-aberration-plan-v1.ts';
import { withChromaticAberrationPixelFrameV1 as borrow } from '../src/common/editor/imaging/pixel-frame-chromatic-aberration-v1.ts';
import { prepareLinearChromaticAberrationV1 as prepare, writeLinearChromaticAberrationV1 as write } from '../src/common/editor/imaging/pixel-frame-linear-chromatic-aberration-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const LIMITS = { maximumSidePixels: 65_536, maximumPixels: 67_108_864, maximumBytes: 268_435_456 };
const BYTE = { schemaVersion: 1, width: 3, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' } as const;
const LINEAR = { ...BYTE, sampleFormat: 'float32', transfer: 'linear' } as const;
const SOURCE = [0, 91, 255, 128, 255, 37, 0, 255, 0, 203, 255, 64];
function bytes(values = SOURCE) { return { descriptor: { ...BYTE, width: values.length / 4 }, pixels: Uint8Array.from(values) }; }
function floats(values: readonly number[], primaries: 'srgb' | 'bt709' = 'srgb') {
	return { descriptor: { ...LINEAR, width: values.length / 4, primaries }, pixels: Float32Array.from(values) };
}
function observed<Value>(task: Promise<Value>) { return task.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
async function reached(task: Promise<unknown>, entered: Promise<void>) {
	await Promise.race([entered, task.then(() => assert.fail('CA settled before its consumer.'), (error: unknown) => { throw error; })]);
}

test('CA scalar metadata pins exact independent coefficients, neutral negative zero and existing natural geometry bounds', () => {
	const plan = planImageChromaticAberrationV1(37.5, -80, 3, 1);
	assert.ok(Object.isFrozen(plan)); assert.equal(plan.redCoefficient, 37.5 * .0001); assert.equal(plan.blueCoefficient, -80 * .0001);
	assert.equal(plan.neutral, false); assert.equal(planImageChromaticAberrationV1(-0, 0, 3, 1).neutral, true);
	assert.ok(Object.is(planImageChromaticAberrationV1(-0, 0, 3, 1).red, 0));
	for (const [w, h] of [[16_384, 4096], [65_536, 1024]] as const) assert.equal(planImageChromaticAberrationV1(100, -100, w, h).width, w);
	for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -100.1, 100.1, null, '0']) {
		assert.throws(() => planImageChromaticAberrationV1(value, 0, 3, 1)); assert.throws(() => planImageChromaticAberrationV1(0, value, 3, 1));
	}
	assert.throws(() => planImageChromaticAberrationV1(0, 0, 65_537, 1), RangeError);
	assert.throws(() => planImageChromaticAberrationV1(0, 0, 65_536, 1025), RangeError);
});

test('Byte CA independently reconstructs radial R/B while Green and reference alpha stay exact', async () => {
	const source = bytes(), before = source.pixels.slice();
	// For3×1, k=-.01 moves edge index by0.004 inward. Unequal tap
	// alpha gives red260.1/128.508→2 and260.1/64.764→4. Positive
	// Blue maps outward but its one supported tap reconstructs unchanged255.
	assert.deepEqual(await borrow({ frame: source, red: -100, blue: 100 }, frame => [...frame.pixels], { limits: LIMITS }),
		[2, 91, 255, 128, 255, 37, 0, 255, 4, 203, 255, 64]);
	assert.deepEqual(await borrow({ frame: source, red: 0, blue: -100 }, frame => [...frame.pixels], { limits: LIMITS }),
		[0, 91, 253, 128, 255, 37, 0, 255, 0, 203, 251, 64]);
	assert.deepEqual(source.pixels, before);
});

test('Corrected zero-support channel becomes zero while hidden Green, zero-controlled Blue and original zero alpha remain intact', async () => {
	const source = bytes([47, 31, 7, 0, 255, 11, 70, 255, 15, 9, 140, 0]);
	assert.deepEqual(await borrow({ frame: source, red: 100, blue: 0 }, frame => [...frame.pixels], { limits: LIMITS }),
		[0, 31, 7, 0, 255, 11, 70, 255, 0, 9, 140, 0]);
	assert.deepEqual(await borrow({ frame: source, red: -100, blue: 0 }, frame => [...frame.pixels], { limits: LIMITS }),
		[255, 31, 7, 0, 255, 11, 70, 255, 255, 9, 140, 0]);
});

for (const control of [-1e-12, -1e-20]) test(`Tiny nonzero CA ${control} retains inward support before absolute-coordinate cancellation in byte and native planes`, async () => {
	for (const [width, height] of [[3, 1], [3, 3]] as const) {
		const center = Math.floor(width * height / 2), byteValues: number[] = [], nativeValues: number[] = [];
		for (let index = 0; index < width * height; index++) {
			byteValues.push(index === center ? 201 : 17 + index, 31 + index, 71 + index, index === center ? 255 : 0);
			nativeValues.push(index === center ? 3.25 : -2, index % 2 === 0 ? -0 : 1e-30, -(2 ** -149), index === center ? .5 : 0);
		}
		const byteSource = { descriptor: { ...BYTE, width, height }, pixels: Uint8Array.from(byteValues) }, byteBefore = byteSource.pixels.slice();
		const byteOutput = await borrow({ frame: byteSource, red: control, blue: 0 }, frame => [...frame.pixels], { limits: LIMITS });
		const source = { descriptor: { ...LINEAR, width, height }, pixels: Float32Array.from(nativeValues) }, nativeBefore = new Uint8Array(source.pixels.buffer).slice();
		const output = new Float32Array(source.pixels.length), plan = prepare(control, 0, source.descriptor, LIMITS);
		assert.equal(planImageChromaticAberrationV1(control, 0, width, height).redCoefficient, control * .0001);
		await write(plan, source, output);
		// Exactly one center has visible alpha. Every tiny inward basis has
		// a positive center tap, including the diagonal product below1e-48.
		// Its own unrounded alpha divisor reconstructs the same center red.
		for (let index = 0; index < width * height; index++) {
			assert.equal(byteOutput[index * 4], 201); assert.equal(output[index * 4], 3.25);
			for (const channel of [1, 2, 3]) {
				assert.equal(byteOutput[index * 4 + channel], byteValues[index * 4 + channel]);
				assert.ok(Object.is(output[index * 4 + channel], source.pixels[index * 4 + channel]));
			}
		}
		assert.deepEqual(byteSource.pixels, byteBefore); assert.deepEqual(new Uint8Array(source.pixels.buffer), nativeBefore);
	}
});

for (const primaries of ['srgb', 'bt709'] as const) test(`Native ${primaries} CA has independent HDR/sub-byte premultiplied rational literals and preserves Green/alpha`, async () => {
	const source = floats([2, -0, 8, .5, 4, 1e-30, -2, 1, 16, -(2 ** -149), 4, 0], primaries), before = new Uint8Array(source.pixels.buffer).slice();
	const target = new Float32Array(12), plan = prepare(-100, 0, source.descriptor, LIMITS);
	assert.equal(plan.scratchBytes, 0); assert.equal(plan.byteLength, 48); assert.ok(Object.isFrozen(plan));
	await write(plan, source, target);
	assert.deepEqual([...target], [...Float32Array.from([506 / 251, -0, 8, .5, 4, 1e-30, -2, 1, 4, -(2 ** -149), 4, 0])]);
	assert.ok(Object.is(target[1], -0)); assert.ok(target[0]! > 2);
	const blue = prepare(0, -100, source.descriptor, LIMITS); await write(blue, source, target);
	assert.deepEqual([...target], [...Float32Array.from([2, -0, 1988 / 251, .5, 4, 1e-30, -2, 1, 16, -(2 ** -149), -2, 0])]);
	assert.deepEqual(new Uint8Array(source.pixels.buffer), before);
});

test('Neutral and independently zero native channels retain exact finite Float32 bits including hidden HDR, tiny values and negative zero', async () => {
	const source = floats([-0, 2 ** -149, 4, 0, 1e-30, -0, -2, 1]), before = new Uint8Array(source.pixels.buffer).slice();
	const target = new Float32Array(8); await write(prepare(0, 0, source.descriptor, LIMITS), source, target);
	assert.deepEqual(new Uint8Array(target.buffer), before);
	await write(prepare(0, 100, source.descriptor, LIMITS), source, target);
	for (let offset = 0; offset < 8; offset += 4) for (const channel of [0, 1, 3]) assert.ok(Object.is(target[offset + channel], source.pixels[offset + channel]));
	const byte = bytes([7, 9, 11, 0, 17, 19, 23, 255]);
	assert.deepEqual(await borrow({ frame: byte, red: 0, blue: -0 }, frame => [...frame.pixels], { limits: LIMITS }), [...byte.pixels]);
});

test('Byte CA processes a 9000-pixel natural aspect with fixed Green/alpha and independently specified radial support', async () => {
	const width = 9000, source = bytes(Array.from({ length: width }, () => [7, 11, 19, 255]).flat());
	const output = await borrow({ frame: source, red: 100, blue: -100 }, frame => [...frame.pixels], { limits: LIMITS });
	for (let x = 0; x < width; x++) {
		const d = x + .5 - 4500, from = 4500 + d * (1 + .01 * d * d / (4500 ** 2 + .25)) - .5;
		const left = Math.floor(from), f = from - left, support = (left >= 0 && left < width ? 1 - f : 0) + (left + 1 >= 0 && left + 1 < width ? f : 0);
		assert.deepEqual(output.slice(x * 4, x * 4 + 4), [support > 0 ? 7 : 0, 11, 19, 255]);
	}
});

test('CA controls, profile and geometry refuse before hostile pixel-descriptor authority', async () => {
	for (const [red, blue, descriptor] of [[101, 0, BYTE], [0, Number.NaN, BYTE], [0, 0, { ...BYTE, width: 65_537 }],
		[0, 0, { ...BYTE, transfer: 'linear' }]] as const) {
		let reads = 0; const marker = Symbol('sample-authority');
		const frame = new Proxy({ descriptor, pixels: undefined }, { getOwnPropertyDescriptor(target, key) {
			if (key === 'pixels') { reads++; throw marker; } return Reflect.getOwnPropertyDescriptor(target, key);
		} });
		const result = await observed(borrow({ frame, red, blue }, () => assert.fail('Invalid CA delivered.'), { limits: LIMITS }));
		if (result.ok) assert.fail('Invalid CA admitted.'); assert.equal(reads, 0); assert.ok(result.error instanceof RangeError);
	}
});

test('CA byte owner charges intrinsic padded backing; native writer rejects padding, alias, forged plans and descriptor drift', async () => {
	const backing = new ArrayBuffer(512 * 1024 * 1024), padded = new Uint8Array(backing, 0, 4); padded.set([1, 2, 3, 255]);
	Object.defineProperty(backing, 'byteLength', { value: 4 });
	try {
		await assert.rejects(borrow({ frame: { descriptor: { ...BYTE, width: 1 }, pixels: padded }, red: 0, blue: 0 }, () => assert.fail('Padded budget ignored.'), { limits: LIMITS }), /physical|working|budget/u);
		assert.deepEqual([...padded], [1, 2, 3, 255]);
	} finally { structuredClone(backing, { transfer: [backing] }); }
	const source = floats([2, 3, 4, 1]), plan = prepare(100, 0, source.descriptor, LIMITS), output = Float32Array.of(9, 9, 9, 9);
	await assert.rejects(write({ ...plan }, source, output), TypeError); await assert.rejects(write(plan, source, source.pixels), TypeError);
	await assert.rejects(write(plan, { ...source, pixels: new Float32Array(new ArrayBuffer(32), 0, 4) }, output), TypeError);
	await assert.rejects(write(plan, { ...source, descriptor: { ...source.descriptor, primaries: 'bt709' } }, output), RangeError);
	assert.deepEqual([...output], [9, 9, 9, 9]);
});

test('Native CA binds descriptor metadata before reflecting pixels and retains finite-plane validation', async () => {
	const source = floats([2, 3, 4, 1]), plan = prepare(100, 0, source.descriptor, LIMITS), output = Float32Array.of(9, 9, 9, 9);
	let reads = 0;
	const drifted = new Proxy({ descriptor: { ...source.descriptor, width: 2 }, pixels: undefined }, {
		getOwnPropertyDescriptor(target, key) { if (key === 'pixels') { reads++; throw Symbol('early-pixels'); } return Reflect.getOwnPropertyDescriptor(target, key); },
	});
	await assert.rejects(write(plan, drifted, output), RangeError); assert.equal(reads, 0);
	for (const values of [[Number.NaN, 0, 0, 1], [0, 0, 0, 1.01]]) await assert.rejects(write(plan, floats(values), output), RangeError);
	const resizable = Reflect.construct(ArrayBuffer, [16, { maxByteLength: 32 }]) as ArrayBuffer;
	for (const pixels of [new Float32Array(new SharedArrayBuffer(16)), new Float32Array(resizable)]) await assert.rejects(write(plan, { ...source, pixels }, output));
	assert.deepEqual([...output], [9, 9, 9, 9]);
});

test('CA byte output joins held consumer cancellation before pinned physical wipe and preserves exact opaque reason', async () => {
	const source = bytes(), before = source.pixels.slice(), stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
	const entered = deferred<void>(), release = deferred<void>(); let backing: Uint8Array<ArrayBuffer> | undefined;
	const work = borrow({ frame: source, red: -100, blue: 100, signal: stop.signal }, async frame => {
		backing = new Uint8Array(frame.pixels.buffer); entered.resolve(); await release.promise; assert.ok(backing.some(value => value !== 0)); return 'held';
	}, { limits: LIMITS }), result = observed(work);
	try {
		await reached(work, entered.promise); stop.abort(reason.proxy); assert.equal(await remainsPending(work), true); release.resolve();
		const settled = await result; if (settled.ok) assert.fail('Cancelled CA delivered.');
		assert.ok(Object.is(settled.error, reason.proxy)); assert.ok(backing?.every(value => value === 0)); assert.deepEqual(source.pixels, before);
	} finally { release.resolve(); await result; }
});

test('CA retains opaque failed-consumer authority plus physical transfer cleanup after abort, and wipes independent borrowed-shadow output', async () => {
	const source = bytes(), before = source.pixels.slice(), reason = Proxy.revocable({}, {}); reason.revoke(); const stop = new AbortController();
	let transferred: ArrayBuffer | undefined;
	try {
		const settled = await observed(borrow({ frame: source, red: -100, blue: 100, signal: stop.signal }, frame => {
			transferred = structuredClone(frame.pixels.buffer, { transfer: [frame.pixels.buffer] }); stop.abort(Symbol('later-abort')); throw reason.proxy;
		}, { limits: LIMITS }));
		if (settled.ok) assert.fail('Transferred CA cannot retire.');
		assert.ok(settled.error instanceof AggregateError); assert.ok(Object.is(settled.error.errors[0], reason.proxy)); assert.ok(settled.error.errors[1] instanceof TypeError);
	} finally { if (transferred) new Uint8Array(transferred).fill(0); }
	let output: Uint8Array<ArrayBuffer> | undefined, reads = 0;
	const failed = await observed(borrow({ frame: source, red: 0, blue: 0 }, frame => {
		output = new Uint8Array(frame.pixels.buffer);
		for (const name of ['buffer', 'byteLength', 'fill']) Object.defineProperty(frame.pixels, name, { get(): never { reads++; throw new Error('Foreign geometry.'); } });
		throw reason.proxy;
	}, { limits: LIMITS }));
	if (failed.ok) assert.fail('Failed consumer delivered.');
	assert.ok(Object.is(failed.error, reason.proxy)); assert.equal(reads, 0); assert.ok(output?.every(value => value === 0)); assert.deepEqual(source.pixels, before);
});
