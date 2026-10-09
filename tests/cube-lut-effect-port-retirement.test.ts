/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { bindCubeLutEffectPortV1, cubeLutEffectPortV1For, retireCubeLutEffectPortsV1, type CubeLutEffectPortV1 } from '../src/common/editor/controller/clip-video/cube-lut-effect-port-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const port = (close: () => Promise<void>): CubeLutEffectPortV1 => ({ capture: () => null, isCurrent: () => false,
	importFile: () => Promise.reject(Error('unused')), clear: () => Promise.resolve(), close });

test('resource retirement is installed before borrowed close reentry, preserves receiver and joins every held producer', async () => {
	const controller = {}, storage = {}, held = deferred<void>(); let nested: Promise<void> | undefined, closes = 0, shadow = 0;
	const first = port(function (this: CubeLutEffectPortV1) { assert.equal(this, first); closes++; nested = retireCubeLutEffectPortsV1(storage); return held.promise; });
	Object.defineProperty(first.close, 'bind', { get() { shadow++; throw Error('bind'); } });
	bindCubeLutEffectPortV1(controller, first, storage); assert.equal(cubeLutEffectPortV1For(controller), first);
	const second = port(() => { closes++; return Promise.resolve(); }); bindCubeLutEffectPortV1({}, second, storage);
	const work = retireCubeLutEffectPortsV1(storage); assert.equal(nested, work); assert.equal(closes, 2); assert.equal(shadow, 0);
	first.close = () => { throw Error('retargeted close'); }; assert.equal(retireCubeLutEffectPortsV1(storage), work);
	assert.equal(await remainsPending(work), true); held.resolve(); await work;
	assert.throws(() => bindCubeLutEffectPortV1({}, port(() => Promise.resolve()), storage), /retired/iu);
});

test('opaque retirement failure still joins another producer and preserves exact duplicate NaN identity', async () => {
	const storage = {}, held = deferred<void>(); let traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); }, getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	bindCubeLutEffectPortV1({}, port(() => { throw reason; }), storage);
	bindCubeLutEffectPortV1({}, port(() => held.promise), storage);
	const work = retireCubeLutEffectPortsV1(storage), observed = work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	assert.equal(await remainsPending(work), true); held.resolve(); assert.equal((await observed).error, reason); assert.equal(traps, 0);
	const other = {}; for (let n = 0; n < 2; n++) bindCubeLutEffectPortV1({}, port(() => Promise.reject(NaN)), other);
	const failure = await retireCubeLutEffectPortsV1(other).then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	assert.ok(Object.is(failure.error, NaN));
});

test('binding cannot append a producer after borrowed close capture synchronously retires the storage anchor', async () => {
	const storage = {}, controller = {}; let closes = 0, closing: Promise<void> | undefined;
	const candidate = Object.defineProperty(port(() => Promise.resolve()), 'close', { get() {
		closing = retireCubeLutEffectPortsV1(storage); return () => { closes++; return Promise.resolve(); };
	} });
	assert.throws(() => bindCubeLutEffectPortV1(controller, candidate, storage), /retired/iu);
	await closing; assert.equal(cubeLutEffectPortV1For(controller), null); assert.equal(closes, 0);
});
