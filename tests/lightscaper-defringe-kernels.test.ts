/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withDefringePixelFrameV1 as borrow } from '../src/common/editor/imaging/pixel-frame-defringe-v1.ts';
import { prepareLinearDefringeV1 as prepare, writeLinearDefringeV1 as write } from '../src/common/editor/imaging/pixel-frame-linear-defringe-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const LIMITS = { maximumSidePixels: 65_536, maximumPixels: 67_108_864, maximumBytes: 268_435_456 };
const BYTE = { schemaVersion: 1, width: 3, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' } as const;
const LINEAR = { ...BYTE, sampleFormat: 'float32', transfer: 'linear' } as const;
function effect(purple = 100, green = 0, edgeThreshold = 25, enabled = true) {
	return { id: 'defringe', type: 'defringe-v1', enabled, params: { purple, green, edgeThreshold } };
}
function bytes(values: readonly number[]) { return { descriptor: { ...BYTE, width: values.length / 4 }, pixels: Uint8Array.from(values) }; }
function floats(values: readonly number[], primaries: 'srgb' | 'bt709' = 'srgb') {
	return { descriptor: { ...LINEAR, width: values.length / 4, primaries }, pixels: Float32Array.from(values) };
}
function encoded(value: number) { const n = Math.abs(value); return Math.sign(value) * (n <= .0031308 ? n * 12.92 : 1.055 * n ** (1 / 2.4) - .055); }
function decoded(value: number) { const n = Math.abs(value); return Math.sign(value) * (n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4); }
function observed<Value>(task: Promise<Value>) { return task.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
async function reached(task: Promise<unknown>, entered: Promise<void>) {
	await Promise.race([entered, task.then(() => assert.fail('Defringe settled before its consumer.'), (error: unknown) => { throw error; })]);
}

test('Defringe has independent purple/green 3×1 literals and copies exact reference alpha', async () => {
	for (const [center, selected, middle] of [[[255, 0, 255], effect(), 73], [[0, 255, 0], effect(0, 100), 182]] as const) {
		const source = bytes([0, 0, 0, 255, ...center, 128, 255, 255, 255, 255]), before = source.pixels.slice();
		assert.deepEqual(await borrow({ frame: source, effect: selected }, frame => [...frame.pixels], { limits: LIMITS }),
			[0, 0, 0, 255, middle, middle, middle, 128, 255, 255, 255, 255]);
		assert.deepEqual(source.pixels, before);
	}
	const source = bytes([0, 0, 0, 255, 255, 0, 255, 255, 255, 255, 255, 255]);
	assert.deepEqual(await borrow({ frame: source, effect: effect(25) }, frame => [...frame.pixels], { limits: LIMITS }),
		[0, 0, 0, 255, 209, 18, 209, 255, 255, 255, 255, 255]);
});

test('Defringe relative excess uses positive-alpha neighbors and includes clamped aliases but excludes the logical center', async () => {
	const source = bytes([0, 0, 0, 64, 102, 51, 102, 255, 255, 255, 255, 128]);
	// Center aliases contribute twice: total neighbor alpha1086, relative
	// purple sum115.2, purpleGate384/905 and amount.5 give weight192/905.
	// Encoded byte luma16779/256 yields independent rounded center94/54/94.
	assert.deepEqual(await borrow({ frame: source, effect: effect(50) }, frame => [...frame.pixels], { limits: LIMITS }),
		[0, 0, 0, 64, 94, 54, 94, 255, 255, 255, 255, 128]);
	const unsupported = bytes([0, 0, 0, 0, 255, 0, 255, 255, 255, 255, 255, 0]);
	assert.deepEqual(await borrow({ frame: unsupported, effect: effect() }, frame => [...frame.pixels], { limits: LIMITS }), [...unsupported.pixels]);
	const hidden = bytes([47, 19, 8, 0, 255, 0, 255, 0, 0, 255, 0, 0]);
	assert.deepEqual(await borrow({ frame: hidden, effect: effect(100, 100, 0) }, frame => [...frame.pixels], { limits: LIMITS }), [...hidden.pixels]);
});

test('Constant colors remain exactly unchanged for arbitrary alpha; neutral edges, disabled controls and threshold100 are exact', async () => {
	for (const rgb of [[255, 0, 255], [0, 255, 0], [19, 19, 19]] as const) {
		const source = bytes([...[...rgb, 1], ...[...rgb, 137], ...[...rgb, 255]]);
		assert.deepEqual(await borrow({ frame: source, effect: effect(100, 100, 0) }, frame => [...frame.pixels], { limits: LIMITS }), [...source.pixels]);
	}
	const source = bytes([0, 0, 0, 255, 255, 0, 255, 255, 255, 255, 255, 255]);
	for (const selected of [effect(0, 0), effect(100, 100, 100), effect(100, 100, 0, false)]) {
		assert.deepEqual(await borrow({ frame: source, effect: selected }, frame => [...frame.pixels], { limits: LIMITS }), [...source.pixels]);
	}
	const neutral = bytes([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
	assert.deepEqual(await borrow({ frame: neutral, effect: effect(100, 100, 0) }, frame => [...frame.pixels], { limits: LIMITS }), [...neutral.pixels]);
});

for (const primaries of ['srgb', 'bt709'] as const) test(`Native ${primaries} Defringe uses continuous signed/HDR encoded correction and rounds once into Float32`, async () => {
	const source = floats([-.25, -.25, -.25, .25, 4, -1e-30, 4, .375, 1, 1, 1, 1], primaries), before = new Uint8Array(source.pixels.buffer).slice();
	const target = new Float32Array(12), plan = prepare(effect(25), source.descriptor, LIMITS);
	assert.equal(plan.scratchBytes, 0); assert.equal(plan.byteLength, 48); assert.ok(Object.isFrozen(plan));
	await write(plan, source, target);
	const r = encoded(4), g = encoded(source.pixels[5]!), y = (73 * r + 183 * g) / 256;
	const expected = Float32Array.from([-.25, -.25, -.25, .25, decoded(r + .25 * (y - r)), decoded(g + .25 * (y - g)), decoded(r + .25 * (y - r)), .375, 1, 1, 1, 1]);
	assert.deepEqual([...target], [...expected]); assert.ok(target[4]! > 1); assert.ok(target[0]! < 0);
	assert.deepEqual(new Uint8Array(source.pixels.buffer), before);
});

test('Native Defringe retains a correction below encoded-byte precision instead of quantizing a working plane', async () => {
	const source = floats([0, 0, 0, 1, .001, 0, .001, 1, 1, 1, 1, 1]), target = new Float32Array(12);
	await write(prepare(effect(), source.descriptor, LIMITS), source, target);
	// Six neutral taps plus two aliased center taps give purpleGate3*R.
	// All involved corrected components remain in the linear sRGB segment.
	const r = source.pixels[4]! * 12.92, y = 73 * r / 256, weight = 3 * r;
	assert.deepEqual([...target], [...Float32Array.from([0, 0, 0, 1, (r + weight * (y - r)) / 12.92, weight * y / 12.92,
		(r + weight * (y - r)) / 12.92, 1, 1, 1, 1, 1])]);
	assert.ok(target[4]! < source.pixels[4]!); assert.ok(target[5]! > 0 && target[5]! < 1 / (255 * 12.92));
});

test('Native no-op and zero-alpha centers preserve hidden HDR, negative zero, normal/subnormal precision and alpha bits', async () => {
	const values = [-0, 2 ** -149, 4, -0, 1e-30, -0, -2, 1], source = floats(values), before = new Uint8Array(source.pixels.buffer).slice();
	for (const selected of [effect(0, 0), effect(100, 100, 100, false)]) {
		const target = new Float32Array(8); await write(prepare(selected, source.descriptor, LIMITS), source, target);
		assert.deepEqual(new Uint8Array(target.buffer), before);
	}
	const target = new Float32Array(8); await write(prepare(effect(100, 100, 0), source.descriptor, LIMITS), source, target);
	for (let channel = 0; channel < 4; channel++) assert.ok(Object.is(target[channel], source.pixels[channel]));
	const constant = floats([4, 1e-30, -0, .25, 4, 1e-30, -0, .75, 4, 1e-30, -0, 1]);
	const flat = new Float32Array(12); await write(prepare(effect(100, 100, 0), constant.descriptor, LIMITS), constant, flat);
	assert.deepEqual(new Uint8Array(flat.buffer), new Uint8Array(constant.pixels.buffer));
});

test('Defringe handles a 9000-pixel natural aspect using immutable incoming samples', async () => {
	const source = bytes(Array.from({ length: 9000 }, (_, x) => x === 4500 ? [255, 0, 255, 255] : x > 4500 ? [255, 255, 255, 255] : [0, 0, 0, 255]).flat());
	const output = await borrow({ frame: source, effect: effect() }, frame => [...frame.pixels], { limits: LIMITS });
	for (let x = 0; x < 9000; x++) assert.deepEqual(output.slice(x * 4, x * 4 + 4), x === 4500 ? [73, 73, 73, 255] : [...source.pixels.slice(x * 4, x * 4 + 4)]);
});

test('Defringe rejects malformed controls, profile, geometry and quota before hostile pixel authority', async () => {
	for (const [selected, descriptor, limits] of [[effect(101), BYTE, LIMITS], [effect(0, -1), BYTE, LIMITS], [effect(1, 1, Number.NaN), BYTE, LIMITS],
		[effect(), { ...BYTE, width: 65_537 }, LIMITS], [effect(), { ...BYTE, transfer: 'linear' }, LIMITS], [effect(), BYTE, { ...LIMITS, maximumBytes: 11 }]] as const) {
		let reads = 0; const marker = Symbol('pixel authority');
		const frame = new Proxy({ descriptor, pixels: undefined }, { getOwnPropertyDescriptor(target, key) {
			if (key === 'pixels') { reads++; throw marker; } return Reflect.getOwnPropertyDescriptor(target, key);
		} });
		const result = await observed(borrow({ frame, effect: selected }, () => assert.fail('Invalid Defringe delivered.'), { limits }));
		if (result.ok) assert.fail('Invalid Defringe admitted.'); assert.equal(reads, 0); assert.ok(result.error instanceof RangeError);
	}
	const params = { purple: 100, green: 0 }; Object.defineProperty(params, 'edgeThreshold', { get(): never { throw new Error('Accessor ran.'); }, enumerable: true });
	await assert.rejects(borrow({ frame: bytes([1, 2, 3, 255]), effect: { ...effect(), params } }, () => {}, { limits: LIMITS }), TypeError);
});

test('Byte Defringe charges padded intrinsic backing and rejects shared/resizable planes; native plans are private and descriptor-bound', async () => {
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
	const source = floats([2, 3, 4, 1]), plan = prepare(effect(), source.descriptor, LIMITS), output = Float32Array.of(9, 9, 9, 9);
	await assert.rejects(write({ ...plan }, source, output), TypeError); await assert.rejects(write(plan, source, source.pixels), TypeError);
	await assert.rejects(write(plan, { ...source, pixels: new Float32Array(new ArrayBuffer(32), 0, 4) }, output), TypeError);
	await assert.rejects(write(plan, { ...source, descriptor: { ...source.descriptor, primaries: 'bt709' } }, output), RangeError);
	let reads = 0; const invalid = new Proxy({ descriptor: { ...source.descriptor, width: 2 }, pixels: undefined }, { getOwnPropertyDescriptor(target, key) {
		if (key === 'pixels') { reads++; throw Symbol('early native pixels'); } return Reflect.getOwnPropertyDescriptor(target, key);
	} });
	await assert.rejects(write(plan, invalid, output), RangeError); assert.equal(reads, 0);
	for (const values of [[Number.NaN, 0, 0, 1], [0, 0, 0, 1.01]]) await assert.rejects(write(plan, floats(values), output), RangeError);
	const nativeResizable = Reflect.construct(ArrayBuffer, [16, { maxByteLength: 32 }]) as ArrayBuffer;
	for (const pixels of [new Float32Array(new SharedArrayBuffer(16)), new Float32Array(nativeResizable)]) {
		await assert.rejects(write(plan, { ...source, pixels }, output));
	}
	assert.deepEqual([...output], [9, 9, 9, 9]);
});

test('Defringe captures effect metadata before yielding and joins held consumer cancellation before physical wipe', async () => {
	const source = bytes([0, 0, 0, 255, 255, 0, 255, 255, 255, 255, 255, 255]), before = source.pixels.slice();
	const selected = effect(), stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
	const entered = deferred<void>(), release = deferred<void>(); let output: Uint8Array<ArrayBuffer> | undefined;
	const work = borrow({ frame: source, effect: selected, signal: stop.signal }, async frame => {
		output = new Uint8Array(frame.pixels.buffer); entered.resolve(); await release.promise; assert.equal(output[4], 73); return 'held';
	}, { limits: LIMITS }), result = observed(work);
	try {
		selected.params.purple = 0; await reached(work, entered.promise); stop.abort(reason.proxy);
		assert.equal(await remainsPending(work), true); release.resolve(); const settled = await result;
		if (settled.ok) assert.fail('Cancelled Defringe delivered.'); assert.ok(Object.is(settled.error, reason.proxy));
		assert.ok(output?.every(value => value === 0)); assert.deepEqual(source.pixels, before);
	} finally { release.resolve(); await result; }
});

test('Defringe preserves opaque consumer failure plus transfer cleanup and ignores output wipe shadows', async () => {
	const source = bytes([0, 0, 0, 255, 255, 0, 255, 255, 255, 255, 255, 255]), before = source.pixels.slice();
	const reason = Proxy.revocable({}, {}); reason.revoke(); const stop = new AbortController(); let transferred: ArrayBuffer | undefined;
	try {
		const settled = await observed(borrow({ frame: source, effect: effect(), signal: stop.signal }, frame => {
			transferred = structuredClone(frame.pixels.buffer, { transfer: [frame.pixels.buffer] }); stop.abort(Symbol('late abort')); throw reason.proxy;
		}, { limits: LIMITS }));
		if (settled.ok) assert.fail('Transferred output retired.'); assert.ok(settled.error instanceof AggregateError);
		assert.ok(Object.is(settled.error.errors[0], reason.proxy)); assert.ok(settled.error.errors[1] instanceof TypeError);
	} finally { if (transferred) new Uint8Array(transferred).fill(0); }
	let output: Uint8Array<ArrayBuffer> | undefined, reads = 0;
	const failed = await observed(borrow({ frame: source, effect: effect(0, 0) }, frame => {
		output = new Uint8Array(frame.pixels.buffer);
		for (const name of ['buffer', 'byteLength', 'fill']) Object.defineProperty(frame.pixels, name, { get(): never { reads++; throw new Error('Foreign geometry.'); } });
		throw reason.proxy;
	}, { limits: LIMITS }));
	if (failed.ok) assert.fail('Failed consumer delivered.'); assert.ok(Object.is(failed.error, reason.proxy));
	assert.equal(reads, 0); assert.ok(output?.every(value => value === 0)); assert.deepEqual(source.pixels, before);
});
