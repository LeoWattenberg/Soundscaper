/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { withImageDevelopLinearFrameV1 } from '../src/common/editor/imaging/image-develop-linear-frame-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { createVideoEffectV2 } from '../src/common/editor/video-effects-v2.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';

const LIMITS = Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 268_435_456 });
const PROFILE = Object.freeze({ source: LIMITS, render: LIMITS });
const descriptor = (sampleFormat: 'float32' | 'unorm16', width = 1, height = 1) => ({ schemaVersion: 1 as const, width, height, sampleFormat, primaries: 'bt709' as const, transfer: 'linear' as const });
const recipe = (effects: readonly unknown[] = []) => ({ ...defaultImageDevelopStateV1(), effects });
function observed<Result>(promise: Promise<Result>) { return promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
function deferred<Value>() { let resolve!: (value: Value | PromiseLike<Value>) => void; const promise = new Promise<Value>(yes => { resolve = yes; }); return { promise, resolve }; }

test('linear frame owner consumes only the genuine Uint16 span and returns direct normalized Float32 values without a byte stage', async () => {
	const backing = new ArrayBuffer(24), words = new Uint16Array(backing); words.fill(413); const pixels = new Uint16Array(backing, 8, 4); pixels.set([1, 257, 32769, 65535]);
	const before = words.slice(); let borrowed: Float32Array | undefined;
	const result = await withImageDevelopLinearFrameV1({ frame: { descriptor: descriptor('unorm16'), pixels }, develop: recipe() }, frame => {
		assert.equal(frame.descriptor.sampleFormat, 'float32'); assert.equal(frame.descriptor.transfer, 'linear'); assert.equal(frame.descriptor.primaries, 'bt709');
		assert.ok(frame.pixels instanceof Float32Array); borrowed = frame.pixels; return [...frame.pixels];
	}, PROFILE);
	assert.deepEqual(result, [Math.fround(1 / 65535), Math.fround(257 / 65535), Math.fround(32769 / 65535), 1]);
	assert.deepEqual(words, before); assert.ok(borrowed!.every(value => value === 0));
});

test('the complete source snapshot precedes the first task and survives caller mutation and transfer of its original backing', async () => {
	const pixels = new Float32Array(256 * 128 * 4), original = [.125, .3125, 4, .5], expected = [.25, .625, 8, .5];
	for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(original, offset);
	const effect = createVideoEffectV2('tone-ladder-v1', { id: 'exposure', params: { exposure: 1 } });
	const work = withImageDevelopLinearFrameV1({ frame: { descriptor: descriptor('float32', 256, 128), pixels }, develop: recipe([effect]) }, frame => {
		for (let offset = 0; offset < frame.pixels.length; offset += 4) assert.deepEqual([...frame.pixels.subarray(offset, offset + 4)], expected);
		return frame.pixels.length;
	}, PROFILE);
	pixels.fill(0); const moved = structuredClone(pixels.buffer, { transfer: [pixels.buffer] }); assert.ok(moved.byteLength > 0);
	assert.equal(await work, 256 * 128 * 4);
});

test('each effect rounds into the actual Float32 working plane while signed/HDR values and alpha remain unclipped', async () => {
	const effects = [createVideoEffectV2('tone-ladder-v1', { id: 'up', params: { exposure: .01 } }), createVideoEffectV2('tone-ladder-v1', { id: 'down', params: { exposure: -.01 } })];
	const input = [-.125, .123456789, 4.125, .375], pixels = Float32Array.from(input), before = pixels.slice();
	const result = await withImageDevelopLinearFrameV1({ frame: { descriptor: descriptor('float32'), pixels }, develop: recipe(effects) }, frame => [...frame.pixels], PROFILE);
	const expected = [...before].map((value, index) => index === 3 ? value : Math.fround(Math.fround(value * 2 ** .01) * 2 ** -.01));
	assert.deepEqual(result, expected); assert.deepEqual(pixels, before); assert.ok(result[0]! < 0); assert.ok(result[2]! > 1);
});

test('native normal/subnormal signed Float32 detail survives exposure then inverse exposure without pivot cancellation', async () => {
	const pixels = Float32Array.of(2 ** -100, -(2 ** -100), 2 ** -149, .375), before = pixels.slice();
	const effects = [createVideoEffectV2('tone-ladder-v1', { id: 'double', params: { exposure: 1 } }),
		createVideoEffectV2('tone-ladder-v1', { id: 'halve', params: { exposure: -1 } })];
	const result = await withImageDevelopLinearFrameV1({ frame: { descriptor: descriptor('float32'), pixels }, develop: recipe(effects) }, frame => [...frame.pixels], PROFILE);
	assert.deepEqual(result, [...before]); assert.deepEqual(pixels, before); assert.ok(result[0]! > 0); assert.ok(result[1]! < 0); assert.equal(result[2], 2 ** -149);
});

test('native linear render admission charges sixteen output bytes per pixel and the aggregate byte bound before pixels', async () => {
	let reads = 0; const poisoned = (width: number, height: number) => ({ descriptor: descriptor('unorm16', width, height), get pixels() { reads++; throw new Error('Pixels were read before quota admission.'); } });
	await assert.rejects(withImageDevelopLinearFrameV1({ frame: poisoned(2, 2), develop: recipe() }, () => undefined,
		{ source: LIMITS, render: { maximumSidePixels: 8, maximumPixels: 64, maximumBytes: 32 } }), /byte|limit/iu);
	const large = { maximumSidePixels: 65_536, maximumPixels: 67_108_864, maximumBytes: 1_073_741_824 };
	await assert.rejects(withImageDevelopLinearFrameV1({ frame: poisoned(8192, 4096), develop: recipe() }, () => undefined,
		{ source: large, render: large }), /512 MiB|working|budget/iu);
	assert.equal(reads, 0);
});

test('native float overflow refuses before delivery and preserves caller storage', async () => {
	const pixels = Float32Array.of(3.4e38, 0, 0, 1), before = pixels.slice(), effect = createVideoEffectV2('tone-ladder-v1', { id: 'overflow', params: { exposure: 5 } });
	await assert.rejects(withImageDevelopLinearFrameV1({ frame: { descriptor: descriptor('float32'), pixels }, develop: recipe([effect]) }, () => assert.fail('Overflow cannot be delivered.'), PROFILE), /finite|Float32|range|overflow/iu);
	assert.deepEqual(pixels, before);
});

test('held linear consumer keeps its plane live through cancellation then joins retirement with the exact opaque reason', async () => {
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); let lent: PixelFrameV1['pixels'] | undefined;
	const pixels = Float32Array.of(-.25, .125, 4, .5), before = pixels.slice();
	const work = observed(withImageDevelopLinearFrameV1({ frame: { descriptor: descriptor('float32'), pixels }, develop: recipe(), signal: stop.signal }, async frame => {
		lent = frame.pixels; entered.resolve(); await release.promise;
	}, PROFILE));
	try {
		assert.equal(await Promise.race([entered.promise.then(() => true), work.then(() => false)]), true); stop.abort(opaque.proxy); assert.deepEqual([...lent!], [...before]);
		release.resolve(); const outcome = await work; assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy)); assert.ok(lent!.every(value => value === 0)); assert.deepEqual(pixels, before);
	} finally { release.resolve(); await work; }
});

test('held linear output transfer preserves an opaque consumer primary and independent physical retirement failure', async () => {
	const pixels = Float32Array.of(.25, .5, 2, 1), before = pixels.slice(), opaque = Proxy.revocable({}, {}); opaque.revoke();
	const outcome = await observed(withImageDevelopLinearFrameV1({ frame: { descriptor: descriptor('float32'), pixels }, develop: recipe() }, frame => {
		structuredClone(frame.pixels.buffer, { transfer: [frame.pixels.buffer] }); throw opaque.proxy;
	}, PROFILE));
	assert.ok(!outcome.ok); assert.ok(outcome.error instanceof AggregateError); assert.ok(Object.is(outcome.error.cause, opaque.proxy));
	assert.ok(outcome.error.errors.some((error: unknown) => Object.is(error, opaque.proxy)));
	assert.ok(outcome.error.errors.some((error: unknown) => !Object.is(error, opaque.proxy) && error instanceof TypeError)); assert.deepEqual(pixels, before);
});

test('consumer shadows cannot replace the privately pinned output wipe geometry', async () => {
	let lent: Float32Array | undefined, realBacking: ArrayBuffer | undefined;
	await withImageDevelopLinearFrameV1({ frame: { descriptor: descriptor('float32'), pixels: Float32Array.of(.5, 1, 2, .75) }, develop: recipe() }, frame => {
		assert.ok(frame.pixels instanceof Float32Array); lent = frame.pixels; realBacking = frame.pixels.buffer;
		Object.defineProperty(frame.pixels, 'buffer', { value: new ArrayBuffer(0) }); Object.defineProperty(frame.pixels, 'byteLength', { value: 0 });
	}, PROFILE);
	assert.ok(realBacking); assert.deepEqual([...new Float32Array(realBacking)], [0, 0, 0, 0]); assert.equal(lent!.byteLength, 0);
});

test('opaque preabort and cancellation from hostile scalar reflection outrank metadata errors before source inspection', async () => {
	for (const alreadyAborted of [true, false]) {
		const stop = new AbortController(), opaque = Proxy.revocable({}, {}); opaque.revoke(); let traps = 0;
		if (alreadyAborted) stop.abort(opaque.proxy);
		const request = new Proxy({ signal: stop.signal }, { ownKeys() { traps++; stop.abort(opaque.proxy); throw new Error('Hostile request reflection.'); } });
		const outcome = await observed(withImageDevelopLinearFrameV1(request, () => undefined, PROFILE));
		assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy)); assert.equal(traps, alreadyAborted ? 0 : 1);
	}
});
