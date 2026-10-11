/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withRepairSpotsPixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-repair-spots-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const PROFILE = { limits: { maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 64 * 1024 * 1024 } };
function frame(width = 3, height = 1) {
	const pixels = new Uint8Array(width * height * 4);
	for (let index = 0; index < pixels.length; index += 4) pixels.set([64, 128, 192, 255], index);
	return { descriptor: { schemaVersion: 1 as const, width, height, sampleFormat: 'unorm8' as const,
		primaries: 'srgb' as const, transfer: 'srgb' as const }, pixels };
}
function spot() {
	return { id: 'repair', mode: 'clone', enabled: true, target: { x: 5 / 6, y: 0.5 },
		source: { x: 1 / 6, y: 0.5 }, radius: 0.1, feather: 0, opacity: 1 };
}
function request(value: unknown = frame(), spots: readonly unknown[] = [spot()]) {
	return { frame: value, repairs: { schemaVersion: 1, spots } };
}
function opaque() { const value = Proxy.revocable({}, {}); value.revoke(); return value.proxy; }
function observe(work: Promise<unknown>) {
	return work.then(() => ({ failed: false, error: undefined as unknown }), (error: unknown) => ({ failed: true, error }));
}
function hostilePixels() {
	const state = { traps: 0 };
	const pixels = new Proxy({}, {
		ownKeys() { state.traps++; throw Error('Repair pixel ownKeys trap'); },
		get() { state.traps++; throw Error('Repair pixel get trap'); },
		getOwnPropertyDescriptor() { state.traps++; throw Error('Repair pixel descriptor trap'); },
		getPrototypeOf() { state.traps++; throw Error('Repair pixel prototype trap'); },
	});
	return { pixels, state };
}
function largeClone() {
	const value = frame(512, 128);
	for (let y = 0; y < 128; y++) for (let x = 0; x < 512; x++) {
		const gray = x < 256 ? 192 : 64; value.pixels.set([gray, gray, gray, 255], (y * 512 + x) * 4);
	}
	const definition = { ...spot(), target: { x: 0.75, y: 0.5 }, source: { x: 0.25, y: 0.5 }, radius: 1 };
	return { value, definition };
}

test('native pre-abort preserves an opaque first reason before nested frame or repair authority reads', async () => {
	const stop = new AbortController(), reason = opaque(); stop.abort(reason); let traps = 0, delivered = 0;
	const unread = new Proxy({}, { ownKeys() { traps++; throw Error('Pre-aborted repair inspected nested authority'); } });
	const outcome = await observe(withRepairSpotsPixelFrameV1({ frame: unread, repairs: unread, signal: stop.signal },
		() => { delivered++; }, PROFILE));
	assert.equal(outcome.failed, true); assert.equal(Object.is(outcome.error, reason), true);
	assert.equal(traps, 0); assert.equal(delivered, 0);
});

test('closed request, repair and profile admission refuses accessors without consulting their getters or pixels', async () => {
	const unread = hostilePixels(), value = { ...frame(), pixels: unread.pixels }; let getters = 0, delivered = 0;
	const accessedFrame = Object.defineProperty({ ...frame() }, 'pixels', { enumerable: true, get() { getters++; return frame().pixels; } });
	const accessedSpot = Object.defineProperty(spot(), 'opacity', { enumerable: true, get() { getters++; return 1; } });
	for (const input of [
		{ ...request(value), future: true },
		request(accessedFrame),
		request(value, [accessedSpot]),
		{ frame: value, repairs: { schemaVersion: 2, spots: [] } },
		{ ...request(value), signal: Object.defineProperty({}, 'aborted', { get() { getters++; return false; } }) },
	]) await assert.rejects(withRepairSpotsPixelFrameV1(input, () => { delivered++; }, PROFILE));
	const badProfile = Object.defineProperty({ ...PROFILE }, 'limits', { enumerable: true, get() { getters++; return PROFILE.limits; } });
	await assert.rejects(Reflect.apply(withRepairSpotsPixelFrameV1, undefined, [request(value), () => { delivered++; }, badProfile]));
	await assert.rejects(Reflect.apply(withRepairSpotsPixelFrameV1, undefined, [request(value), () => { delivered++; }, { ...PROFILE, future: true }]));
	assert.equal(getters, 0); assert.equal(unread.state.traps, 0); assert.equal(delivered, 0);
});

test('unsupported encoded frame declarations and caller limits refuse before native pixel reflection', async () => {
	const unread = hostilePixels(), base = frame(); let delivered = 0;
	for (const change of [{ sampleFormat: 'unorm16' }, { sampleFormat: 'float32' }, { primaries: 'bt709' },
		{ primaries: 'display-p3' }, { transfer: 'linear' }, { transfer: 'pq' }, { schemaVersion: 2 }]) {
		await assert.rejects(withRepairSpotsPixelFrameV1(request({ descriptor: { ...base.descriptor, ...change }, pixels: unread.pixels }),
			() => { delivered++; }, PROFILE));
	}
	await assert.rejects(withRepairSpotsPixelFrameV1(request({ ...base, pixels: unread.pixels }), () => { delivered++; },
		{ limits: { ...PROFILE.limits, maximumBytes: 11 } }), /limit|byte|budget/iu);
	assert.equal(unread.state.traps, 0); assert.equal(delivered, 0);
});

test('complete repair work and source-byte budgets refuse valid data pixel fields before any backing reads', async () => {
	const unread = hostilePixels(); let delivered = 0;
	const input = (width: number, height: number, mode: string, count = 1) => request({ descriptor: { ...frame().descriptor, width, height }, pixels: unread.pixels },
		Array.from({ length: count }, (_, index) => ({ ...spot(), id: `repair-${index}`, mode,
			target: { x: 0.5, y: 0.5 }, source: { x: 0.5, y: 0.5 }, radius: 1 })));
	for (const value of [input(4097, 4096, 'clone'), input(4096, 4096, 'clone', 2),
		input(513, 513, 'heal'), input(512, 512, 'heal', 2)]) {
		await assert.rejects(withRepairSpotsPixelFrameV1(value, () => { delivered++; }, PROFILE), /limit|budget|512|relaxation|visit|byte/iu);
	}
	assert.equal(unread.state.traps, 0); assert.equal(delivered, 0);
});

test('native fixed exact RGBA ownership rejects wrong spans, shared or resizable buffers without consumer delivery', async () => {
	const value = frame(), original = value.pixels.slice(); let delivered = 0;
	for (const pixels of [value.pixels.subarray(1), new Uint8Array(new SharedArrayBuffer(12)),
		new Uint8Array(Reflect.construct(ArrayBuffer, [12, { maxByteLength: 24 }]) as ArrayBuffer)]) {
		await assert.rejects(withRepairSpotsPixelFrameV1(request({ ...value, pixels }), () => { delivered++; }, PROFILE));
	}
	assert.equal(delivered, 0); assert.deepEqual(value.pixels, original);
});

test('scalar repairs and original pixels are captured before a real yielding Clone operation', async () => {
	const { value, definition } = largeClone(); let delivered = 0;
	const work = withRepairSpotsPixelFrameV1(request(value, [definition]), output => {
		delivered++; return [...output.pixels.slice((64 * 512 + 384) * 4, (64 * 512 + 384) * 4 + 4)];
	}, PROFILE);
	// The rectangle visits 32768 pixels, exceeding the required 16384-operation yield bound.
	definition.source.x = 0.75; definition.opacity = 0; value.pixels.fill(0);
	assert.deepEqual(await work, [192, 192, 192, 255]); assert.equal(delivered, 1);
	assert.equal(value.pixels.every(byte => byte === 0), true);
});

test('native cancellation during actual yielding work prevents delivery and preserves the caller original', async () => {
	const { value, definition } = largeClone(), original = value.pixels.slice(), stop = new AbortController(), reason = opaque();
	let delivered = 0;
	const work = withRepairSpotsPixelFrameV1({ ...request(value, [definition]), signal: stop.signal }, () => { delivered++; }, PROFILE);
	const observed = observe(work); stop.abort(reason); const outcome = await observed;
	assert.equal(outcome.failed, true); assert.equal(Object.is(outcome.error, reason), true);
	assert.equal(delivered, 0); assert.deepEqual(value.pixels, original);
});

test('queued native cancellation joins a genuine Heal Jacobi yield without delivering or changing the original', async () => {
	const value = frame(128, 128), stop = new AbortController(), reason = opaque(); let delivered = 0;
	for (let y = 48; y < 80; y++) for (let x = 16; x < 48; x++) value.pixels.set([192, 192, 192, 255], (y * 128 + x) * 4);
	value.pixels.set([0, 0, 0, 255], (64 * 128 + 96) * 4); const original = value.pixels.slice();
	const definition = { ...spot(), mode: 'heal', target: { x: 0.75, y: 0.5 }, source: { x: 0.25, y: 0.5 }, radius: 0.1 };
	const work = withRepairSpotsPixelFrameV1({ ...request(value, [definition]), signal: stop.signal }, () => { delivered++; }, PROFILE);
	const observed = observe(work);
	// Halo population/context/RHS total <16384 cells; 64 complete Jacobi sweeps exceed it.
	// The kernel's first queued timer is therefore a real solver yield, before this native abort.
	const cancellation = setTimeout(() => { stop.abort(reason); }, 0);
	try {
		const outcome = await observed; assert.equal(outcome.failed, true); assert.equal(Object.is(outcome.error, reason), true);
		assert.equal(delivered, 0); assert.deepEqual(value.pixels, original);
	} finally { clearTimeout(cancellation); }
});

test('held output consumers join cancellation before native backing wipe and preserve opaque first reason', async () => {
	const value = frame(), original = value.pixels.slice(), stop = new AbortController(), reason = opaque();
	const entered = deferred<void>(), release = deferred<void>(), retained: { backing?: ArrayBuffer } = {};
	const work = withRepairSpotsPixelFrameV1({ ...request(value), signal: stop.signal }, async output => {
		assert.equal(output.descriptor.sampleFormat, 'unorm8'); assert.ok(output.pixels instanceof Uint8Array);
		retained.backing = output.pixels.buffer; assert.deepEqual([...output.pixels], [...original]);
		entered.resolve(); await release.promise; return 'borrow complete';
	}, PROFILE), observed = observe(work);
	try {
		await Promise.race([entered.promise, work]); stop.abort(reason);
		assert.equal(await remainsPending(work), true); assert.ok(retained.backing);
		assert.deepEqual([...new Uint8Array(retained.backing)], [...original]); assert.deepEqual(value.pixels, original);
	} finally { release.resolve(); await observed; }
	const outcome = await observed; assert.equal(outcome.failed, true); assert.equal(Object.is(outcome.error, reason), true);
	assert.ok(retained.backing); assert.equal(new Uint8Array(retained.backing).every(byte => byte === 0), true);
	assert.deepEqual(value.pixels, original);
});

test('consumer buffer and fill shadows cannot replace an opaque failure or prevent wiping the actual backing', async () => {
	const value = frame(), original = value.pixels.slice(), reason = opaque(); let getters = 0;
	const retained: { backing?: ArrayBuffer } = {};
	const outcome = await observe(withRepairSpotsPixelFrameV1(request(value), output => {
		assert.ok(output.pixels instanceof Uint8Array); retained.backing = output.pixels.buffer;
		for (const key of ['buffer', 'fill', 'length', 'byteLength', 'byteOffset']) Object.defineProperty(output.pixels, key,
			{ get() { getters++; throw Error('Borrower shadow replaced cleanup authority'); } });
		throw reason;
	}, PROFILE));
	assert.equal(outcome.failed, true); assert.equal(Object.is(outcome.error, reason), true); assert.equal(getters, 0);
	assert.ok(retained.backing); assert.equal(new Uint8Array(retained.backing).every(byte => byte === 0), true);
	assert.deepEqual(value.pixels, original);
});

test('successful joined consumer results survive retirement while only the owned output is wiped', async () => {
	const value = frame(), original = value.pixels.slice(), entered = deferred<void>(), release = deferred<void>();
	const retained: { backing?: ArrayBuffer } = {};
	const work = withRepairSpotsPixelFrameV1(request(value), async output => {
		assert.ok(output.pixels instanceof Uint8Array); retained.backing = output.pixels.buffer;
		entered.resolve(); await release.promise; return 73;
	}, PROFILE), observed = observe(work);
	try { await Promise.race([entered.promise, work]); assert.equal(await remainsPending(work), true); }
	finally { release.resolve(); await observed; }
	assert.equal(await work, 73); assert.ok(retained.backing);
	assert.equal(new Uint8Array(retained.backing).every(byte => byte === 0), true); assert.deepEqual(value.pixels, original);
});

test('detaching an exposed native backing refuses successful retirement instead of claiming a wipe', async () => {
	const value = frame(), original = value.pixels.slice();
	const retained: { transferred?: Uint8Array<ArrayBuffer> } = {};
	const outcome = await observe(withRepairSpotsPixelFrameV1(request(value), output => {
		assert.ok(output.pixels instanceof Uint8Array);
		retained.transferred = structuredClone(output.pixels, { transfer: [output.pixels.buffer] }); return 73;
	}, PROFILE));
	assert.equal(outcome.failed, true); assert.ok(outcome.error instanceof Error);
	assert.match(outcome.error.message, /detach|backing|retire|wipe|cleanup/iu);
	assert.ok(retained.transferred); assert.deepEqual(retained.transferred, original); assert.deepEqual(value.pixels, original);
});

test('detached output cleanup retains an opaque consumer primary and a distinct actual retirement failure', async () => {
	const value = frame(), original = value.pixels.slice(), reason = opaque();
	const retained: { transferred?: Uint8Array<ArrayBuffer> } = {};
	const outcome = await observe(withRepairSpotsPixelFrameV1(request(value), output => {
		assert.ok(output.pixels instanceof Uint8Array);
		retained.transferred = structuredClone(output.pixels, { transfer: [output.pixels.buffer] }); throw reason;
	}, PROFILE));
	assert.equal(outcome.failed, true); assert.ok(outcome.error instanceof AggregateError);
	const failures: readonly unknown[] = outcome.error.errors;
	assert.equal(failures.length, 2); assert.equal(Object.is(failures[0], reason), true);
	assert.ok(failures[1] instanceof Error); assert.match(failures[1].message, /detach|backing|retire|wipe|cleanup/iu);
	assert.ok(retained.transferred); assert.deepEqual(retained.transferred, original); assert.deepEqual(value.pixels, original);
});
