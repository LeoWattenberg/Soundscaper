/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { withCubeLutProfilePixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-cube-lut-profile-v1.ts';
import type { CubeLutSourcePortV1 } from '../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';

const LIMITS = { maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 16 * 1024 * 1024 };
const SWAP = ['LUT_3D_SIZE 2', '0 0 0', '0 0 1', '0 1 0', '0 1 1', '1 0 0', '1 0 1', '1 1 0', '1 1 1'].join('\n');
const BODY = new TextEncoder().encode(SWAP), PARSED = parseCubeLutV1(SWAP);
const REF = { storageKey: `lut-sha256:${PARSED.sha256}`, sha256: PARSED.sha256, byteLength: PARSED.byteLength,
	size: PARSED.size, domainMin: PARSED.domainMin, domainMax: PARSED.domainMax };
const effect = (lut: unknown = REF, enabled = true) => ({ id: 'cube', type: 'cube-lut-profile-v1', enabled, params: { lut } });
function frame(samples: readonly number[] = [64, 91, 128, 0, 255, 91, 32, 1]) {
	return { descriptor: { schemaVersion: 1, width: samples.length / 4, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: new Uint8Array(samples) };
}
function source(bytes = BODY): CubeLutSourcePortV1 {
	return { async withBytes(reference, consume) { assert.deepEqual(reference, REF); return consume(bytes); } };
}

test('scoped cube profile preserves V27 swapped hidden RGB and every straight alpha without changing source', async () => {
	const samples = Array.from({ length: 256 }, (_, alpha) => [alpha, 91, 255 - alpha, alpha]).flat();
	const input = frame(samples), before = input.pixels.slice();
	const expected = Array.from({ length: 256 }, (_, alpha) => [255 - alpha, 91, alpha, alpha]).flat();
	const actual = await withCubeLutProfilePixelFrameV1({ frame: input, effect: effect() }, output => Array.from(output.pixels), { limits: LIMITS, source: source() });
	assert.deepEqual(actual, expected);
	assert.deepEqual(input.pixels, before);
});

test('null and disabled effects bypass resource access, decoding and output allocation with byte identity', async () => {
	const input = frame(), hostile = Object.defineProperty({}, 'withBytes', { get() { assert.fail('bypass touched source'); } });
	for (const candidate of [effect(null), effect(REF, false)]) {
		await withCubeLutProfilePixelFrameV1({ frame: input, effect: candidate }, output => {
			assert.equal(output.pixels, input.pixels);
			assert.deepEqual(output.descriptor, input.descriptor);
		}, { limits: LIMITS, source: hostile as CubeLutSourcePortV1 });
	}
	await assert.rejects(withCubeLutProfilePixelFrameV1({ frame: input, effect: effect({ ...REF, sha256: 'invalid' }, false) },
		() => assert.fail('invalid disabled effect consumed'), { limits: LIMITS }));
});

test('missing active resource refuses before source pixels are traversed and a lying body cannot be authenticated by metadata alone', async () => {
	let inspected = 0;
	const input = Object.defineProperty(frame(), 'pixels', { enumerable: true, get() { inspected++; throw new Error('pixels read'); } });
	await assert.rejects(withCubeLutProfilePixelFrameV1({ frame: input, effect: effect() }, () => assert.fail('missing source consumed'), { limits: LIMITS }), /source|resource/iu);
	assert.equal(inspected, 0);
	await assert.rejects(withCubeLutProfilePixelFrameV1({ frame: frame(), effect: effect() }, () => assert.fail('wrong digest consumed'),
		{ limits: LIMITS, source: source(new TextEncoder().encode(SWAP.replace('0 0 1', '0 0 0'))) }), /digest|SHA|length/iu);
});

test('native cancellation joins held source and output consumers, preserving opaque identity and wiped transformed backing', async () => {
	const controller = new AbortController();
	let traps = 0, release!: () => void, entered!: () => void;
	const reason = new Proxy({}, { get() { traps++; throw new Error('reason get'); }, getOwnPropertyDescriptor() { traps++; throw new Error('reason descriptor'); }, getPrototypeOf() { traps++; throw new Error('reason prototype'); } });
	const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
	const input = frame(), before = input.pixels.slice();
	let output: Readonly<PixelFrameV1> | undefined, sourceJoined = false, settled = false;
	const port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { try { return await consume(BODY); } finally { sourceJoined = true; } } };
	const operation = withCubeLutProfilePixelFrameV1({ frame: input, effect: effect(), signal: controller.signal }, async value => { output = value; entered(); await held; }, { limits: LIMITS, source: port });
	const outcome = operation.then(() => ({ rejected: false, error: undefined as unknown }), error => ({ rejected: true, error: error as unknown }));
	void outcome.then(() => { settled = true; });
	await started; controller.abort(reason); await Promise.resolve();
	assert.equal(settled, false); assert.equal(sourceJoined, false); release();
	assert.deepEqual(await outcome, { rejected: true, error: reason });
	assert.equal(output?.pixels.every(byte => byte === 0), true);
	assert.equal(sourceJoined, true); assert.deepEqual(input.pixels, before); assert.equal(traps, 0);
});

test('port receiver and identity are captured before its await and consumer refusal joins without inspecting opaque failures', async () => {
	let entered!: () => void, release!: () => void, returned = false, traps = 0;
	const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
	const reason = new Proxy({}, { get() { traps++; throw new Error('opaque get'); } });
	const port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { assert.equal(this, port); entered(); await held; try { return await consume(BODY); } finally { returned = true; } } };
	const operation = withCubeLutProfilePixelFrameV1({ frame: frame(), effect: effect() }, () => { throw reason; }, { limits: LIMITS, source: port });
	const outcome = operation.then(() => ({ error: undefined as unknown }), error => ({ error: error as unknown }));
	await started; port.withBytes = () => { throw new Error('replacement invoked'); }; release();
	assert.equal((await outcome).error, reason); assert.equal(returned, true); assert.equal(traps, 0);
});

test('capturing the port never reads a shadowed function bind property', async () => {
	let binds = 0;
	const port = source(), native = port.withBytes;
	Object.defineProperty(native, 'bind', { get() { binds++; throw new Error('borrowed bind inspected'); } });
	await withCubeLutProfilePixelFrameV1({ frame: frame(), effect: effect() }, output => {
		assert.deepEqual(Array.from(output.pixels), [128, 91, 64, 0, 32, 91, 255, 1]);
	}, { limits: LIMITS, source: port });
	assert.equal(binds, 0);
});

test('an early-returning source cannot settle a held body consumer or admit a second callback', async () => {
	let entered!: () => void, release!: () => void, callback: ((bytes: Uint8Array<ArrayBuffer>) => unknown) | undefined;
	const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
	let settled = false, output: Readonly<PixelFrameV1> | undefined;
	const port: CubeLutSourcePortV1 = { withBytes(_reference, consume) { callback = consume; void consume(BODY); return Promise.resolve(undefined as never); } };
	const operation = withCubeLutProfilePixelFrameV1({ frame: frame(), effect: effect() }, async value => { output = value; entered(); await held; return 7; }, { limits: LIMITS, source: port });
	void operation.then(() => { settled = true; });
	await started; await Promise.resolve(); assert.equal(settled, false);
	assert.throws(() => callback!(BODY), /retired|already admitted/u);
	release(); assert.equal(await operation, 7);
	assert.equal(output?.pixels.every(byte => byte === 0), true);
});

test('distinct opaque body and source cleanup failures are retained after both settle', async () => {
	let traps = 0, release!: () => void, entered!: () => void, settled = false;
	const hostile = () => new Proxy({}, { get() { traps++; throw new Error('opaque get'); }, getOwnPropertyDescriptor() { traps++; throw new Error('opaque descriptor'); }, getPrototypeOf() { traps++; throw new Error('opaque prototype'); } });
	const primary = hostile(), cleanup = hostile();
	const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
	let output: Readonly<PixelFrameV1> | undefined;
	const port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { void consume(BODY); await started; throw cleanup; } };
	const operation = withCubeLutProfilePixelFrameV1({ frame: frame(), effect: effect() }, async value => { output = value; entered(); await held; throw primary; }, { limits: LIMITS, source: port });
	const outcome = operation.then(() => ({ error: undefined as unknown }), error => ({ error: error as unknown }));
	void outcome.then(() => { settled = true; });
	await started; await Promise.resolve(); assert.equal(settled, false); release();
	const error = (await outcome).error;
	assert.equal(error instanceof AggregateError, true);
	assert.deepEqual((error as AggregateError).errors, [primary, cleanup]);
	assert.equal((error as AggregateError).cause, primary);
	assert.equal(output?.pixels.every(byte => byte === 0), true); assert.equal(traps, 0);
});

test('pre-aborted native cancellation refuses before effect, frame and capability reflection', async () => {
	const stop = new AbortController(); let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw new Error('reason get'); } });
	const unread = new Proxy({}, { ownKeys() { traps++; throw new Error('nested keys'); } });
	stop.abort(reason);
	const outcome = await withCubeLutProfilePixelFrameV1({ frame: unread, effect: unread, signal: stop.signal },
		() => assert.fail('aborted consumer entered'), { limits: LIMITS, source: unread as CubeLutSourcePortV1 })
		.then(() => ({ error: undefined as unknown }), error => ({ error: error as unknown }));
	assert.equal(outcome.error, reason); assert.equal(traps, 0);
});

test('source transfer during a held body demand refuses delivery after the native resource joins', async () => {
	let entered!: () => void, release!: () => void, joined = false;
	const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
	const input = frame();
	const port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { entered(); await held; try { return await consume(BODY); } finally { joined = true; } } };
	const operation = withCubeLutProfilePixelFrameV1({ frame: input, effect: effect() }, () => assert.fail('transferred source delivered'), { limits: LIMITS, source: port });
	await started; structuredClone(input.pixels.buffer, { transfer: [input.pixels.buffer] }); release();
	await assert.rejects(operation, /detached|changed|length|sample count/u); assert.equal(joined, true);
});

test('the identical native NaN cancellation reason survives both joined failures without aggregation', async () => {
	const stop = new AbortController(); let entered!: () => void, release!: () => void, joined = false;
	const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
	const port: CubeLutSourcePortV1 = { async withBytes(_reference, consume) { try { return await consume(BODY); } finally { joined = true; } } };
	const operation = withCubeLutProfilePixelFrameV1({ frame: frame(), effect: effect(), signal: stop.signal },
		async () => { entered(); await held; }, { limits: LIMITS, source: port });
	const outcome = operation.then(() => ({ error: undefined as unknown }), error => ({ error: error as unknown }));
	await started; stop.abort(NaN); release();
	assert.equal((await outcome).error, NaN); assert.equal(joined, true);
});
