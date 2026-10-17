/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareImageOpticalVignetteKernelV1 as scalar, imageOpticalVignetteGainV1 as gain } from '../src/common/editor/imaging/image-optical-vignette-kernel-v1.ts';
import { withOpticalVignettePixelFrameV1 as borrow } from '../src/common/editor/imaging/pixel-frame-optical-vignette-v1.ts';
import { prepareLinearOpticalVignetteV1 as prepare, writeLinearOpticalVignetteV1 as write } from '../src/common/editor/imaging/pixel-frame-linear-optical-vignette-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const LIMITS = { maximumSidePixels: 65_536, maximumPixels: 67_108_864, maximumBytes: 268_435_456 };
const BYTE = { schemaVersion: 1, width: 3, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' } as const;
const LINEAR = { ...BYTE, sampleFormat: 'float32', transfer: 'linear' } as const;
function effect(amount = 100, enabled = true) { return { id: 'optical', type: 'optical-vignette-v1', enabled, params: { amount } }; }
function bytes(values: readonly number[]) { return { descriptor: { ...BYTE, width: values.length / 4 }, pixels: Uint8Array.from(values) }; }
function floats(values: readonly number[], primaries: 'srgb' | 'bt709' = 'srgb') {
	return { descriptor: { ...LINEAR, width: values.length / 4, primaries }, pixels: Float32Array.from(values) };
}
function observed<Value>(task: Promise<Value>) { return task.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
async function reached(task: Promise<unknown>, entered: Promise<void>) {
	await Promise.race([entered, task.then(() => assert.fail('Optical vignette settled before its consumer.'), (error: unknown) => { throw error; })]);
}
function encodedByte(value: number, multiplier: number): number {
	const code = value / 255, linear = (code <= .04045 ? code / 12.92 : ((code + .055) / 1.055) ** 2.4) * multiplier;
	const encoded = linear <= .0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - .055;
	return Math.round(255 * Math.min(1, Math.max(0, encoded)));
}

test('Optical vignette scalar metadata has exact sqrt2 and 2^.8 pixel-center gains with existing natural bounds', () => {
	const plan = scalar(100, 2, 2); assert.ok(Object.isFrozen(plan));
	for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) assert.equal(gain(plan, x, y), Math.SQRT2);
	const line = scalar(100, 3, 1); assert.equal(gain(line, 0, 0), 2 ** .8); assert.equal(gain(line, 1, 0), 1); assert.equal(gain(line, 2, 0), 2 ** .8);
	assert.equal(gain(scalar(-100, 3, 1), 0, 0), 2 ** -.8);
	assert.ok(Object.is(scalar(-0, 3, 1).amount, 0)); assert.equal(gain(scalar(100, 1, 1), 0, 0), 1);
	for (const [width, height] of [[16_384, 4096], [65_536, 1024]] as const) assert.equal(scalar(37.125, width, height).width, width);
	for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -100.01, 100.01, null, '0']) assert.throws(() => scalar(value, 3, 1), RangeError);
	assert.throws(() => scalar(0, 65_537, 1), RangeError); assert.throws(() => scalar(0, 65_536, 1025), RangeError);
});

test('Byte optical vignette multiplies decoded light, keeps center/alpha exact and clips only at byte delivery', async () => {
	const source = bytes([64, 32, 16, 255, 64, 32, 16, 128, 64, 32, 16, 1]), before = source.pixels.slice();
	assert.deepEqual(await borrow({ frame: source, effect: effect() }, frame => [...frame.pixels], { limits: LIMITS }),
		[84, 44, 24, 255, 64, 32, 16, 128, 84, 44, 24, 1]);
	assert.deepEqual(await borrow({ frame: source, effect: effect(-100) }, frame => [...frame.pixels], { limits: LIMITS }),
		[48, 23, 10, 255, 64, 32, 16, 128, 48, 23, 10, 1]);
	const clipping = bytes([255, 0, 128, 255, 255, 0, 128, 255, 255, 0, 128, 255]);
	const clipped = await borrow({ frame: clipping, effect: effect() }, frame => [...frame.pixels], { limits: LIMITS });
	assert.equal(clipped[0], 255); assert.equal(clipped[1], 0); assert.equal(clipped[2], encodedByte(128, 2 ** .8));
	assert.deepEqual(source.pixels, before);
});

test('Byte optical sqrt2, identity, alpha-zero hidden color and black preservation use exact branches', async () => {
	const source = { descriptor: { ...BYTE, width: 2, height: 2 }, pixels: Uint8Array.from([64, 32, 16, 255, 47, 19, 8, 0, 0, 0, 0, 7, 128, 64, 32, 128]) };
	const expected = [...source.pixels];
	for (const index of [0, 12]) for (let channel = 0; channel < 3; channel++) expected[index + channel] = encodedByte(source.pixels[index + channel]!, Math.SQRT2);
	assert.deepEqual(await borrow({ frame: source, effect: effect() }, frame => [...frame.pixels], { limits: LIMITS }), expected);
	for (const selected of [effect(0), effect(-0), effect(100, false)]) {
		assert.deepEqual(await borrow({ frame: source, effect: selected }, frame => [...frame.pixels], { limits: LIMITS }), [...source.pixels]);
	}
	const center = bytes([7, 19, 213, 255]);
	assert.deepEqual(await borrow({ frame: center, effect: effect() }, frame => [...frame.pixels], { limits: LIMITS }), [...center.pixels]);
});

for (const primaries of ['srgb', 'bt709'] as const) test(`Native optical ${primaries} directly multiplies signed HDR light and preserves reference alpha`, async () => {
	const source = { descriptor: { ...LINEAR, width: 2, height: 2, primaries }, pixels: Float32Array.from([2, -1, .001, .5, 0, -0, 4, 1, -2, 3, 1e-30, .25, 47, -19, 8, 0]) };
	const before = new Uint8Array(source.pixels.buffer).slice();
	for (const amount of [100, -100]) {
		const target = new Float32Array(16), plan = prepare(effect(amount), source.descriptor, LIMITS);
		assert.ok(Object.isFrozen(plan)); assert.equal(plan.sampleCount, 16); assert.equal(plan.byteLength, 64); assert.equal(plan.scratchBytes, 0);
		await write(plan, source, target);
		const expected = source.pixels.slice(), multiplier = 2 ** (amount / 200);
		for (const index of [0, 4, 8]) for (let channel = 0; channel < 3; channel++) {
			const sample = source.pixels[index + channel]!; expected[index + channel] = sample === 0 ? sample : Math.fround(sample * multiplier);
		}
		assert.deepEqual(new Uint8Array(target.buffer), new Uint8Array(expected.buffer));
		assert.ok(Object.is(target[5], -0)); assert.deepEqual(new Uint8Array(source.pixels.buffer), before);
		if (amount > 0) { assert.ok(target[0]! > 2); assert.ok(target[1]! < -1); }
	}
});

test('Native optical gain1/disabled/zero channels retain negative-zero, tiny and subnormal bits; tiny corrections do not use a byte plane', async () => {
	const source = floats([1e-30, 2 ** -126, 2 ** -149, 1, -0, 3.4028234663852886e38, -(2 ** -149), -0, -1e-30, -(2 ** -126), -(2 ** -149), .5]);
	const before = new Uint8Array(source.pixels.buffer).slice();
	for (const selected of [effect(0), effect(100, false)]) {
		const target = new Float32Array(12); await write(prepare(selected, source.descriptor, LIMITS), source, target);
		assert.deepEqual(new Uint8Array(target.buffer), before);
	}
	const target = new Float32Array(12); await write(prepare(effect(), source.descriptor, LIMITS), source, target);
	for (const index of [0, 2]) for (let channel = 0; channel < 3; channel++) assert.ok(Object.is(target[index * 4 + channel], Math.fround(source.pixels[index * 4 + channel]! * 2 ** .8)));
	for (let channel = 0; channel < 4; channel++) assert.ok(Object.is(target[4 + channel], source.pixels[4 + channel]));
	assert.equal(target[2], 2 * 2 ** -149); assert.ok(target[0]! > source.pixels[0]!);
	assert.deepEqual(new Uint8Array(source.pixels.buffer), before);
	const center = floats([3.4028234663852886e38, -0, 2 ** -149, 1]), identity = new Float32Array(4);
	await write(prepare(effect(), center.descriptor, LIMITS), center, identity);
	assert.deepEqual(new Uint8Array(identity.buffer), new Uint8Array(center.pixels.buffer));
});

test('Native optical overflow is refused before writing that pixel and never clips or mutates the source', async () => {
	const source = { descriptor: { ...LINEAR, width: 2, height: 2 }, pixels: Float32Array.from([3.4028234663852886e38, 0, 0, 1, ...Array<number>(12).fill(0)]) };
	const target = new Float32Array(16).fill(9), before = source.pixels.slice();
	await assert.rejects(write(prepare(effect(), source.descriptor, LIMITS), source, target), RangeError);
	assert.ok(target.every(value => value === 9)); assert.deepEqual(source.pixels, before);
});

test('Optical byte handles 9000×1 and1×9000 natural aspects with incoming-grid gains and captured effect fields', async () => {
	for (const [width, height] of [[9000, 1], [1, 9000]] as const) {
		const source = { descriptor: { ...BYTE, width, height }, pixels: Uint8Array.from(Array.from({ length: width * height }, () => [64, 32, 16, 255]).flat()) };
		const selected = effect(), task = borrow({ frame: source, effect: selected }, frame => [...frame.pixels], { limits: LIMITS }); selected.params.amount = -100;
		const output = await task;
		for (let index = 0; index < width * height; index++) {
			const x = index % width, y = Math.floor(index / width), radius = ((2 * x + 1 - width) ** 2 + (2 * y + 1 - height) ** 2) / (width * width + height * height);
			assert.deepEqual(output.slice(index * 4, index * 4 + 4), [64, 32, 16].map(value => encodedByte(value, 2 ** (2 * radius))).concat(255));
		}
	}
});

test('Optical controls, closed fields, profile, geometry and quota are admitted before hostile pixels', async () => {
	for (const [selected, descriptor, limits] of [[effect(101), BYTE, LIMITS], [effect(Number.NaN), BYTE, LIMITS], [effect(), { ...BYTE, width: 65_537 }, LIMITS],
		[effect(), { ...BYTE, transfer: 'linear' }, LIMITS], [effect(), BYTE, { ...LIMITS, maximumBytes: 11 }]] as const) {
		let reads = 0; const frame = new Proxy({ descriptor, pixels: undefined }, { getOwnPropertyDescriptor(target, key) {
			if (key === 'pixels') { reads++; throw Symbol('early pixels'); } return Reflect.getOwnPropertyDescriptor(target, key);
		} });
		const result = await observed(borrow({ frame, effect: selected }, () => assert.fail('Invalid optical request delivered.'), { limits }));
		if (result.ok) assert.fail('Invalid optical request admitted.'); assert.ok(result.error instanceof RangeError); assert.equal(reads, 0);
	}
	const source = bytes([1, 2, 3, 255]); let accessors = 0; const params = {};
	Object.defineProperty(params, 'amount', { get(): never { accessors++; throw new Error('Accessor ran.'); }, enumerable: true });
	await assert.rejects(borrow({ frame: source, effect: { ...effect(), params } }, () => {}, { limits: LIMITS }), TypeError); assert.equal(accessors, 0);
	await assert.rejects(borrow({ frame: source, effect: effect(), extra: true }, () => {}, { limits: LIMITS }), TypeError);
	await assert.rejects(borrow({ frame: source, effect: effect() }, null as never, { limits: LIMITS }), TypeError);
});

test('Optical byte charges physical padded backing, and byte/native planes reject forged geometry and shared/resizable storage', async () => {
	const backing = new ArrayBuffer(512 * 1024 * 1024), padded = new Uint8Array(backing, 0, 4); padded.set([1, 2, 3, 255]);
	Object.defineProperty(backing, 'byteLength', { value: 4 });
	try {
		await assert.rejects(borrow({ frame: { descriptor: { ...BYTE, width: 1 }, pixels: padded }, effect: effect() }, () => assert.fail('Padded budget ignored.'), { limits: LIMITS }), /physical|working|budget/u);
		assert.deepEqual([...padded], [1, 2, 3, 255]);
	} finally { structuredClone(backing, { transfer: [backing] }); }
	const resizable = Reflect.construct(ArrayBuffer, [4, { maxByteLength: 8 }]) as ArrayBuffer;
	for (const pixels of [new Uint8Array(new SharedArrayBuffer(4)), new Uint8Array(resizable)]) {
		await assert.rejects(borrow({ frame: { descriptor: { ...BYTE, width: 1 }, pixels }, effect: effect() }, () => {}, { limits: LIMITS }));
	}
	const source = floats([2, 3, 4, 1]), plan = prepare(effect(), source.descriptor, LIMITS), target = Float32Array.of(9, 9, 9, 9);
	await assert.rejects(write({ ...plan }, source, target), TypeError); await assert.rejects(write(plan, source, source.pixels), TypeError);
	await assert.rejects(write(plan, { ...source, pixels: new Float32Array(new ArrayBuffer(32), 0, 4) }, target), TypeError);
	await assert.rejects(write(plan, { ...source, descriptor: { ...source.descriptor, primaries: 'bt709' } }, target), RangeError);
	let reads = 0; const invalid = new Proxy({ descriptor: { ...source.descriptor, width: 2 }, pixels: undefined }, { getOwnPropertyDescriptor(record, key) {
		if (key === 'pixels') { reads++; throw Symbol('early native pixels'); } return Reflect.getOwnPropertyDescriptor(record, key);
	} });
	await assert.rejects(write(plan, invalid, target), RangeError); assert.equal(reads, 0);
	for (const values of [[Number.NaN, 0, 0, 1], [0, 0, 0, 1.01]]) await assert.rejects(write(plan, floats(values), target), RangeError);
	const nativeResizable = Reflect.construct(ArrayBuffer, [16, { maxByteLength: 32 }]) as ArrayBuffer;
	for (const pixels of [new Float32Array(new SharedArrayBuffer(16)), new Float32Array(nativeResizable)]) await assert.rejects(write(plan, { ...source, pixels }, target));
	assert.deepEqual([...target], [9, 9, 9, 9]);
});

test('Optical byte joins held consumer cancellation before pinned physical wipe and preserves opaque cancellation', async () => {
	const source = bytes([64, 32, 16, 255, 64, 32, 16, 255, 64, 32, 16, 255]), before = source.pixels.slice();
	const stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); const entered = deferred<void>(), release = deferred<void>();
	let output: Uint8Array<ArrayBuffer> | undefined;
	const work = borrow({ frame: source, effect: effect(), signal: stop.signal }, async frame => {
		output = new Uint8Array(frame.pixels.buffer); entered.resolve(); await release.promise; assert.equal(output[0], 84); return 'held';
	}, { limits: LIMITS }), result = observed(work);
	try {
		await reached(work, entered.promise); stop.abort(reason.proxy); assert.equal(await remainsPending(work), true); release.resolve();
		const settled = await result; if (settled.ok) assert.fail('Cancelled optical output delivered.');
		assert.ok(Object.is(settled.error, reason.proxy)); assert.ok(output?.every(value => value === 0)); assert.deepEqual(source.pixels, before);
	} finally { release.resolve(); await result; }
});

test('Optical byte retains opaque consumer failure plus transfer refusal and never uses caller wipe shadows', async () => {
	const source = bytes([64, 32, 16, 255, 64, 32, 16, 255, 64, 32, 16, 255]), before = source.pixels.slice();
	const reason = Proxy.revocable({}, {}); reason.revoke(); const stop = new AbortController(); let transferred: ArrayBuffer | undefined;
	try {
		const result = await observed(borrow({ frame: source, effect: effect(), signal: stop.signal }, frame => {
			transferred = structuredClone(frame.pixels.buffer, { transfer: [frame.pixels.buffer] }); stop.abort(Symbol('late abort')); throw reason.proxy;
		}, { limits: LIMITS }));
		if (result.ok) assert.fail('Transferred output retired.'); assert.ok(result.error instanceof AggregateError);
		assert.ok(Object.is(result.error.errors[0], reason.proxy)); assert.ok(result.error.errors[1] instanceof TypeError);
	} finally { if (transferred) new Uint8Array(transferred).fill(0); }
	let output: Uint8Array<ArrayBuffer> | undefined, reads = 0;
	const failed = await observed(borrow({ frame: source, effect: effect(0) }, frame => {
		output = new Uint8Array(frame.pixels.buffer);
		for (const name of ['buffer', 'byteLength', 'fill']) Object.defineProperty(frame.pixels, name, { get(): never { reads++; throw new Error('Foreign geometry.'); } });
		throw reason.proxy;
	}, { limits: LIMITS }));
	if (failed.ok) assert.fail('Failed consumer delivered.'); assert.ok(Object.is(failed.error, reason.proxy));
	assert.equal(reads, 0); assert.ok(output?.every(value => value === 0)); assert.deepEqual(source.pixels, before);
});
