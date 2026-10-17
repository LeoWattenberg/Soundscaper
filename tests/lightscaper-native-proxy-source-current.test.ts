/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	NATIVE_DEVELOP_PROXY_WORKING_BYTES_CURRENT_V1 as MAXIMUM,
	prepareNativeDevelopProxySourceCurrentV1 as prepare,
	withNativeDevelopProxySourceCurrentV1 as borrow,
} from '../src/common/editor/imaging/native-develop-proxy-source-current-v1.ts';
import type { PixelFrameDescriptorV1, PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const LINEAR = { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'float32', primaries: 'srgb', transfer: 'linear' } as const satisfies PixelFrameDescriptorV1;
function words(values: readonly number[], width = values.length / 4, height = 1, primaries: 'srgb' | 'bt709' = 'srgb'): PixelFrameV1 {
	return { descriptor: { ...LINEAR, width, height, sampleFormat: 'unorm16', primaries }, pixels: Uint16Array.from(values) };
}
function floats(values: readonly number[], primaries: 'srgb' | 'bt709' = 'srgb'): PixelFrameV1 {
	return { descriptor: { ...LINEAR, width: values.length / 4, primaries }, pixels: Float32Array.from(values) };
}
function byteFrame(pixels = Uint8Array.of(1, 127, 254, 63)): PixelFrameV1 {
	return { descriptor: { ...LINEAR, width: pixels.length / 4, sampleFormat: 'unorm8', transfer: 'srgb' }, pixels };
}
function raw(frame: Readonly<PixelFrameV1>): Uint8Array<ArrayBuffer> {
	return new Uint8Array(frame.pixels.buffer, frame.pixels.byteOffset, frame.pixels.byteLength);
}
function result<Value>(work: Promise<Value>) {
	return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
async function enteredBeforeSettlement(work: Promise<unknown>, entered: Promise<void>): Promise<void> {
	await Promise.race([entered, work.then(() => { assert.fail('Proxy work settled before entering its consumer.'); }, (error: unknown) => { throw error; })]);
}

for (const primaries of ['srgb', 'bt709'] as const) {
	test(`Native proxy retains adjacent ${primaries} UNORM16 words and exact alpha without a byte or float intermediate`, async () => {
		const source = words([1, 2, 32768, 32769, 65534, 65535, 0, 65535], 2, 1, primaries), before = raw(source).slice();
		const plan = prepare(source); let backing: Uint8Array<ArrayBuffer> | undefined;
		assert.ok(Object.isFrozen(plan)); assert.ok(Object.isFrozen(plan.sourcePlan)); assert.ok(Object.isFrozen(plan.proxyPlan.descriptor));
		const value = await borrow(plan, plan.proxyPlan.byteLength, frame => {
			assert.ok(frame.pixels instanceof Uint16Array); assert.equal(Object.getPrototypeOf(frame.pixels), Uint16Array.prototype);
			assert.deepEqual(frame.descriptor, source.descriptor); assert.notEqual(frame.pixels.buffer, source.pixels.buffer);
			backing = raw(frame); return [...frame.pixels];
		});
		assert.deepEqual(value, [1, 2, 32768, 32769, 65534, 65535, 0, 65535]);
		assert.deepEqual(raw(source), before); assert.ok(backing?.every(value => value === 0));
	});
	test(`Native proxy retains ${primaries} signed HDR, negative zero and tiny Float32 bit patterns`, async () => {
		const source = floats([-0, -.25, 4, .375, 1e-30, -(2 ** -126), 2 ** -149, 0], primaries), before = raw(source).slice();
		const plan = prepare(source); let backing: Uint8Array<ArrayBuffer> | undefined;
		const copied = await borrow(plan, plan.proxyPlan.byteLength, frame => {
			assert.ok(frame.pixels instanceof Float32Array); assert.ok(Object.is(frame.pixels[0], -0));
			backing = raw(frame); return backing.slice();
		});
		assert.deepEqual(copied, before); assert.deepEqual(raw(source), before); assert.ok(backing?.every(value => value === 0));
	});
}

test('Native proxy fits the rounded aspect once and samples a literal top-left nearest lattice in native words', async () => {
	const width = 4095, height = 3, pixels = new Uint16Array(width * height * 4);
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels.set([x, y, x + y * width, 65535], (y * width + x) * 4);
	const source: PixelFrameV1 = { descriptor: { ...LINEAR, width, height, sampleFormat: 'unorm16' }, pixels }, before = raw(source).slice();
	const plan = prepare(source);
	assert.equal(plan.sourcePlan.byteLength, 4095 * 3 * 8);
	assert.deepEqual(plan.proxyPlan.descriptor, { ...source.descriptor, width: 2048, height: 2 });
	const value = await borrow(plan, plan.proxyPlan.byteLength, frame => [...frame.pixels]);
	assert.deepEqual(value.slice(0, 8), [0, 0, 0, 65535, 1, 0, 1, 65535]);
	assert.deepEqual(value.slice(2047 * 4, 2049 * 4), [4093, 0, 4093, 65535, 0, 1, 4095, 65535]);
	assert.deepEqual(value.slice(-4), [4093, 1, 8188, 65535]);
	for (let y = 0; y < 2; y++) for (let x = 0; x < 2048; x++) {
		const sx = Math.floor(x * 4095 / 2048), sy = Math.floor(y * 3 / 2), offset = (y * 2048 + x) * 4;
		assert.deepEqual(value.slice(offset, offset + 4), [sx, sy, sx + sy * 4095, 65535]);
	}
	assert.deepEqual(raw(source), before);
});

test('Native proxy captures all selected samples synchronously before its first yield', async () => {
	const source = floats([-.25, 2, 1e-30, .5]), plan = prepare(source), before = raw(source).slice();
	const work = borrow(plan, plan.proxyPlan.byteLength, frame => raw(frame).slice());
	source.pixels.fill(0);
	assert.deepEqual(await work, before); assert.ok(source.pixels.every(value => value === 0));
});

test('Native proxy preserves exact legacy encoded byte samples including hidden RGB in a dedicated scoped plane', async () => {
	for (const pixels of [Uint8Array.of(1, 127, 254, 0), Uint8ClampedArray.of(2, 128, 255, 63)]) {
		const source: PixelFrameV1 = { descriptor: { ...LINEAR, sampleFormat: 'unorm8', transfer: 'srgb' }, pixels }, plan = prepare(source);
		let backing: Uint8Array<ArrayBuffer> | undefined;
		const value = await borrow(plan, plan.proxyPlan.byteLength, frame => { backing = raw(frame); return [...frame.pixels]; });
		assert.deepEqual(value, [...pixels]); assert.ok(backing?.every(sample => sample === 0)); assert.deepEqual([...pixels], value);
	}
});

test('Native proxy metadata rejects unsupported profiles and full geometry without touching pixel accessors', () => {
	let reads = 0;
	for (const descriptor of [
		{ ...LINEAR, width: 8193 }, { ...LINEAR, width: 4097, height: 4096 },
		{ ...LINEAR, transfer: 'srgb' }, { ...LINEAR, primaries: 'display-p3' },
		{ ...LINEAR, sampleFormat: 'unorm16', transfer: 'bt709' },
		{ ...LINEAR, sampleFormat: 'unorm8', primaries: 'bt709', transfer: 'srgb' },
	]) {
		assert.throws(() => prepare({ descriptor, get pixels(): never { reads++; throw new Error('No early samples.'); } }), RangeError);
	}
	assert.equal(reads, 0);
	const plan = prepare({ descriptor: LINEAR, get pixels(): never { reads++; throw new Error('No metadata samples.'); } });
	assert.equal(plan.proxyPlan.byteLength, 16); assert.equal(reads, 0);
});

test('Native proxy rejects malformed peak and forged plans before consulting pixels', async () => {
	let reads = 0, deliveries = 0;
	const plan = prepare({ descriptor: LINEAR, get pixels(): never { reads++; throw new Error('No early pixels.'); } });
	for (const peak of [-1, 0, 15, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAXIMUM + 1]) {
		await assert.rejects(borrow(plan, peak, () => { deliveries++; }), RangeError);
	}
	await assert.rejects(borrow({ ...plan }, 16, () => { deliveries++; }), TypeError);
	await assert.rejects(borrow(plan, 16, null as unknown as () => void), TypeError);
	assert.equal(reads, 0); assert.equal(deliveries, 0);
});

test('Native proxy refuses a declared full Original plus downstream peak above its aggregate bound before pixel descriptors', async () => {
	let reads = 0, deliveries = 0;
	const marker = Symbol('inaccessible-original-pixel-authority');
	const frame = new Proxy({ descriptor: { ...LINEAR, width: 8192, height: 2048 }, pixels: null }, {
		getOwnPropertyDescriptor(target, key) {
			if (key === 'pixels') { reads++; throw marker; }
			return Reflect.getOwnPropertyDescriptor(target, key);
		},
	});
	const plan = prepare(frame), peak = MAXIMUM - plan.sourcePlan.byteLength + 1;
	assert.ok(peak >= plan.proxyPlan.byteLength);
	const settled = await result(borrow(plan, peak, () => { deliveries++; }));
	if (settled.ok) assert.fail('An impossible declared aggregate may not allocate or deliver a proxy.');
	assert.equal(reads, 0); assert.equal(deliveries, 0); assert.ok(settled.error instanceof RangeError);
});

test('Native proxy charges full padded intrinsic backing plus downstream peak exactly once', async () => {
	const buffer = new ArrayBuffer(8192), pixels = new Uint8Array(buffer, 4096, 4); pixels.set([3, 127, 251, 255]);
	Object.defineProperty(buffer, 'byteLength', { value: 4 });
	const source = byteFrame(pixels), plan = prepare(source); let deliveries = 0;
	await assert.rejects(borrow(plan, MAXIMUM - 4096, () => { deliveries++; }), /aggregate physical/);
	assert.equal(deliveries, 0);
	assert.deepEqual(await borrow(plan, MAXIMUM - 8192, frame => [...frame.pixels]), [3, 127, 251, 255]);
	assert.deepEqual([...pixels], [3, 127, 251, 255]);
});

test('Native proxy captures descriptor metadata once despite subsequent caller field replacement', async () => {
	const source = words([1, 2, 3, 65535]), plan = prepare(source);
	Object.defineProperty(source, 'descriptor', { value: { ...source.descriptor, width: 2 }, configurable: true, enumerable: true });
	assert.deepEqual(await borrow(plan, plan.proxyPlan.byteLength, frame => ({ descriptor: frame.descriptor, pixels: [...frame.pixels] })),
		{ descriptor: { ...LINEAR, sampleFormat: 'unorm16' }, pixels: [1, 2, 3, 65535] });
});

test('Native proxy refuses malformed, detached, shared, resizable and shadowed sample bodies before delivery', async () => {
	const detached = new Uint8Array(4); structuredClone(detached.buffer, { transfer: [detached.buffer] });
	const shadowed = Uint8Array.of(1, 2, 3, 4); Object.defineProperty(shadowed, 'byteLength', { value: 4 });
	const resizable = Reflect.construct(ArrayBuffer, [4, { maxByteLength: 8 }]) as ArrayBuffer;
	const invalid: unknown[] = [detached, shadowed, new Uint8Array(new SharedArrayBuffer(4)), new Uint8Array(resizable), Uint8Array.of(1, 2, 3)];
	let deliveries = 0;
	for (const pixels of invalid) {
		const plan = prepare({ descriptor: { ...LINEAR, sampleFormat: 'unorm8', transfer: 'srgb' }, pixels });
		await assert.rejects(borrow(plan, 4, () => { deliveries++; }));
	}
	for (const values of [[Number.NaN, 0, 0, 1], [0, 0, 0, 1.01], [Number.POSITIVE_INFINITY, 0, 0, 1]]) {
		const plan = prepare(floats(values)); await assert.rejects(borrow(plan, 16, () => { deliveries++; }), RangeError);
	}
	assert.equal(deliveries, 0);
});

test('Native proxy joins held consumer cancellation and retires its physical backing with exact opaque reason', async () => {
	const stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke();
	const source = floats([-.25, 2, 1e-30, .5]), before = raw(source).slice(), plan = prepare(source, stop.signal);
	const entered = deferred<void>(), release = deferred<void>(); let backing: Uint8Array<ArrayBuffer> | undefined;
	const work = borrow(plan, plan.proxyPlan.byteLength, async frame => {
		backing = raw(frame); entered.resolve(); await release.promise;
		assert.ok(backing.some(value => value !== 0)); return 'held';
	}), observed = result(work);
	try {
		await enteredBeforeSettlement(work, entered.promise); stop.abort(reason.proxy);
		assert.equal(await remainsPending(work), true); assert.ok(backing?.some(value => value !== 0)); release.resolve();
		const settled = await observed; if (settled.ok) assert.fail('Cancelled proxy may not deliver a result.');
		assert.ok(Object.is(settled.error, reason.proxy)); assert.ok(backing?.every(value => value === 0)); assert.deepEqual(raw(source), before);
	} finally { release.resolve(); await observed; }
});

test('Native proxy cancellation before preparation or delivery preserves exact reason and skips its consumer', async () => {
	const stop = new AbortController(), reason = Proxy.revocable({}, {}); reason.revoke(); stop.abort(reason.proxy);
	let error: unknown; try { prepare({ descriptor: LINEAR }, stop.signal); } catch (failure) { error = failure; }
	assert.ok(Object.is(error, reason.proxy));
	const next = new AbortController(), source = byteFrame(), plan = prepare(source, next.signal); let deliveries = 0;
	const observed = result(borrow(plan, plan.proxyPlan.byteLength, () => { deliveries++; })); next.abort(reason.proxy);
	const settled = await observed; if (settled.ok) assert.fail('Cancelled proxy may not enter its consumer.');
	assert.ok(Object.is(settled.error, reason.proxy)); assert.equal(deliveries, 0); assert.deepEqual([...source.pixels], [1, 127, 254, 63]);
});

test('Native proxy retires pinned output despite hostile borrower shadows and preserves an opaque consumer failure', async () => {
	const source = floats([-.25, 2, 1e-30, .5]), before = raw(source).slice(), plan = prepare(source), reason = Proxy.revocable({}, {}); reason.revoke();
	let backing: Uint8Array<ArrayBuffer> | undefined, reads = 0;
	const settled = await result(borrow(plan, plan.proxyPlan.byteLength, frame => {
		backing = raw(frame);
		for (const name of ['buffer', 'byteLength', 'fill']) Object.defineProperty(frame.pixels, name,
			{ get(): never { reads++; throw new Error('Borrower does not own retirement.'); } });
		throw reason.proxy;
	}));
	if (settled.ok) assert.fail('Failed consumer may not deliver.');
	assert.ok(Object.is(settled.error, reason.proxy)); assert.equal(reads, 0); assert.ok(backing?.every(value => value === 0)); assert.deepEqual(raw(source), before);
});

for (const detach of [false, true]) test(`Native proxy retains downstream cleanup aggregate after abort${detach ? ' together with its own detach failure' : ''}`, async () => {
	const source = floats([-.25, 2, 1e-30, .5]), before = raw(source).slice(), stop = new AbortController(), plan = prepare(source, stop.signal);
	const primary = Proxy.revocable({}, {}); primary.revoke();
	const cleanup = new TypeError('Downstream physical cleanup failed.'), aggregate = new AggregateError([primary.proxy, cleanup], 'Downstream failed.', { cause: primary.proxy });
	let backing: Uint8Array<ArrayBuffer> | undefined, transferred: ArrayBuffer | undefined;
	const settled = await result(borrow(plan, plan.proxyPlan.byteLength, frame => {
		backing = raw(frame);
		if (detach) transferred = structuredClone(frame.pixels.buffer, { transfer: [frame.pixels.buffer] });
		stop.abort(primary.proxy); throw aggregate;
	}));
	if (settled.ok) assert.fail('A downstream cleanup failure cannot deliver.');
	if (detach) {
		assert.ok(settled.error instanceof AggregateError); assert.equal(settled.error.errors.length, 2);
		assert.ok(Object.is(settled.error.errors[0], aggregate)); assert.ok(settled.error.errors[1] instanceof TypeError);
		assert.ok(transferred); new Uint8Array(transferred).fill(0);
	} else { assert.ok(Object.is(settled.error, aggregate)); assert.ok(backing?.every(value => value === 0)); }
	assert.deepEqual(raw(source), before);
});

for (const fail of [false, true]) test(`Native proxy refuses physical output transfer and retains ${fail ? 'primary plus cleanup' : 'cleanup'} failure`, async () => {
	const source = words([1, 2, 32768, 65535]), before = raw(source).slice(), plan = prepare(source), primary = Proxy.revocable({}, {}); primary.revoke();
	let transferred: ArrayBuffer | undefined;
	const settled = await result(borrow(plan, plan.proxyPlan.byteLength, frame => {
		transferred = structuredClone(frame.pixels.buffer, { transfer: [frame.pixels.buffer] });
		if (fail) throw primary.proxy; return 'unretired';
	}));
	if (settled.ok) assert.fail('Transferred proxy bytes cannot certify retirement.');
	if (fail) {
		assert.ok(settled.error instanceof AggregateError); assert.equal(settled.error.errors.length, 2);
		assert.ok(Object.is(settled.error.errors[0], primary.proxy)); assert.ok(settled.error.errors[1] instanceof TypeError);
	} else assert.ok(settled.error instanceof TypeError);
	assert.ok(transferred); assert.equal(transferred.byteLength, 8); assert.deepEqual(new Uint16Array(transferred), Uint16Array.of(1, 2, 32768, 65535));
	new Uint8Array(transferred).fill(0); assert.deepEqual(raw(source), before);
});
