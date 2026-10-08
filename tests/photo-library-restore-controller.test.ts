/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoLibraryRestoreV1 } from '../src/common/editor/controller/shared/photo-library-restore-v1.ts';
import type { PhotoLibraryRestoreReceiptV1, PhotoLibraryRestoreRuntimeV1 } from '../src/common/editor/photo-library-restore-port-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const receipt = (): PhotoLibraryRestoreReceiptV1 => Object.freeze({ catalogId: 'same-catalog', catalogName: 'Restored',
	photoCount: 2, stackCount: 1, savedCollectionCount: 1, originalCount: 1, originalByteLength: 3, notices: Object.freeze([]) });
const file = () => new Blob([new Uint8Array([1])]);
const runtime = (restoreArchive: PhotoLibraryRestoreRuntimeV1['restoreArchive'] = async () => receipt()): PhotoLibraryRestoreRuntimeV1 => ({ restoreArchive, close: async () => undefined });

test('restore retires old workflow synchronously and joins its close before loading or invoking backend', async () => {
	const owner = new PhotoLibraryRestoreV1(), drain = deferred<void>(), events: string[] = [];
	const running = owner.start({ blob: file(), retireAndJoin: () => { events.push('retire'); return drain.promise; },
		loadRuntime: async () => { events.push('load'); return runtime(async () => { events.push('restore'); return receipt(); }); } });
	assert.deepEqual(events, ['retire']); assert.equal(owner.isPending(), true);
	await assert.rejects(owner.start(new Proxy({} as never, { ownKeys() { throw new Error('Overlapping request inspected.'); } })), /pending/u);
	assert.equal(await remainsPending(running), true); drain.resolve(); assert.deepEqual(await running, receipt());
	assert.deepEqual(events, ['retire', 'load', 'restore']); await owner.close();
});

test('failed native old-session drain blocks backend admission without erasing earlier durable receipt', async () => {
	const owner = new PhotoLibraryRestoreV1(), failure = new Error('Old close failed.'); let loads = 0;
	const request = { blob: file(), retireAndJoin: async () => undefined, loadRuntime: async () => { loads++; return runtime(); } };
	const known = await owner.start(request);
	await assert.rejects(owner.start({ ...request, retireAndJoin: async () => { throw failure; } }), error => error === failure);
	assert.equal(loads, 1); assert.equal(owner.receipt(), known); await owner.close();
});

test('held native restore ACK survives exact opaque cancellation and receipt retirement callback failure', async () => {
	const owner = new PhotoLibraryRestoreV1(), entered = deferred<void>(), ack = deferred<PhotoLibraryRestoreReceiptV1>(), stop = new AbortController();
	let signal: AbortSignal | undefined, reflections = 0, activated = 0;
	const reason = new Proxy({}, { get() { reflections++; throw new Error('Opaque reason read.'); }, getPrototypeOf() { reflections++; throw new Error('Opaque reason inspected.'); } });
	const running = owner.start({ blob: file(), signal: stop.signal, retireAndJoin: async () => undefined,
		loadRuntime: async () => runtime(async (_blob, options) => { signal = options?.signal; entered.resolve(); return ack.promise; }),
		onAcknowledged: () => { activated++; throw new Error('Replacement refresh failed.'); } });
	await entered.promise; stop.abort(reason); assert.equal(signal?.aborted, true); assert.equal(await remainsPending(owner.cancelAndJoin()), true);
	ack.resolve(receipt()); const known = await running;
	assert.deepEqual(known, receipt()); assert.equal(owner.receipt(), known); assert.equal(activated, 1); assert.equal(reflections, 0); await owner.close();
});

test('close joins a runtime loader resolving late and closes its resource without invoking restore', async () => {
	const owner = new PhotoLibraryRestoreV1(), loading = deferred<PhotoLibraryRestoreRuntimeV1>(), entered = deferred<void>(); let restores = 0, closes = 0;
	const running = owner.start({ blob: file(), retireAndJoin: async () => undefined, loadRuntime: () => { entered.resolve(); return loading.promise; } });
	const rejected = running.then(() => assert.fail('Closed restore returned.'), () => undefined);
	await entered.promise; const closing = owner.close(); assert.equal(await remainsPending(closing), true);
	loading.resolve({ restoreArchive: async () => { restores++; return receipt(); }, close: async () => { closes++; } });
	await rejected; await closing; assert.equal(restores, 0); assert.equal(closes, 1);
});

test('native runtime cleanup failure stays observable while known receipt survives close', async () => {
	const owner = new PhotoLibraryRestoreV1(), cleanup = new Error('Runtime close failed.');
	const known = await owner.start({ blob: file(), retireAndJoin: async () => undefined,
		loadRuntime: async () => ({ restoreArchive: async () => receipt(), close: async () => { throw cleanup; } }) });
	await assert.rejects(owner.close(), error => error === cleanup); assert.deepEqual(owner.receipt(), known);
});

test('closed receipt admission rejects future fields/accessors without calling them', async () => {
	for (const bad of [{ ...receipt(), future: true }, Object.defineProperty({ ...receipt() }, 'catalogId', { enumerable: true, get() { throw new Error('Getter ran.'); } }), { ...receipt(), photoCount: -0 }]) {
		const owner = new PhotoLibraryRestoreV1();
		await assert.rejects(owner.start({ blob: file(), retireAndJoin: async () => undefined, loadRuntime: async () => runtime(async () => bad as PhotoLibraryRestoreReceiptV1) }), /unsupported|data|integer/u);
		assert.equal(owner.receipt(), null); await owner.close();
	}
});

test('native blob and caller signal admission refuse before retiring or loading any resource', async () => {
	const owner = new PhotoLibraryRestoreV1(), stop = new AbortController(); let retired = 0, loaded = 0;
	const request = { blob: file(), retireAndJoin: async () => { retired++; }, loadRuntime: async () => { loaded++; return runtime(); } };
	await assert.rejects(owner.start({ ...request, blob: {} as Blob }));
	const reason = 17; stop.abort(reason);
	let failure: unknown; try { await owner.start({ ...request, signal: stop.signal }); } catch (error) { failure = error; }
	assert.equal(failure, reason); assert.equal(retired, 0); assert.equal(loaded, 0); await owner.close();
});

test('bound runtime methods remain captured while an active restore is held', async () => {
	const owner = new PhotoLibraryRestoreV1(), entered = deferred<void>(), held = deferred<PhotoLibraryRestoreReceiptV1>(); let closes = 0;
	const value = { restoreArchive: async () => { entered.resolve(); return held.promise; }, close: async () => { closes++; } };
	const running = owner.start({ blob: file(), retireAndJoin: async () => undefined, loadRuntime: async () => value });
	await entered.promise; value.close = async () => { throw new Error('Replacement close ran.'); };
	held.resolve(receipt()); await running; await owner.close(); assert.equal(closes, 1);
});

test('descriptor admission cannot overwrite a restore admitted by a reentrant own-data trap', async () => {
	const owner = new PhotoLibraryRestoreV1(), held = deferred<void>(); let nested: Promise<Readonly<PhotoLibraryRestoreReceiptV1>> | undefined, retirements = 0;
	const request = { blob: file(), retireAndJoin: () => { retirements++; return held.promise; }, loadRuntime: async () => runtime() };
	const input = new Proxy(request, { ownKeys(target) { nested ??= owner.start(request); return Reflect.ownKeys(target); } });
	const outer = owner.start(input); void outer.catch(() => undefined);
	try {
		assert.equal(retirements, 1); assert.equal(owner.isPending(), true); await assert.rejects(outer, /pending/u);
	} finally { held.resolve(); await nested; await outer.catch(() => undefined); await owner.close(); }
});

test('pre-ACK native cancellation classifies its exact opaque reason without reflection', async () => {
	const owner = new PhotoLibraryRestoreV1(), stop = new AbortController(), entered = deferred<void>(), held = deferred<void>(); let inspected = 0;
	const reason = new Proxy({}, { get() { inspected++; throw new Error('Opaque read'); }, getPrototypeOf() { inspected++; throw new Error('Opaque prototype'); } });
	const running = owner.start({ blob: file(), signal: stop.signal, retireAndJoin: async () => undefined,
		loadRuntime: async () => runtime(async (_blob, options) => { entered.resolve(); await held.promise; options?.signal?.throwIfAborted(); return receipt(); }) });
	const result = running.then(() => assert.fail('Cancelled restore acknowledged'), error => { assert.equal(error, reason); });
	await entered.promise; stop.abort(reason); held.resolve(); await result;
	assert.equal(owner.wasCancelled(), true); assert.equal(inspected, 0); assert.equal(owner.receipt(), null);
	await assert.rejects(owner.start({ blob: new Blob(), retireAndJoin: async () => undefined, loadRuntime: async () => runtime() }), /nonempty/u);
	assert.equal(owner.wasCancelled(), false); await owner.close();
});

test('late descriptor cancellation is refused before synchronous retirement or lazy loading', async () => {
	const owner = new PhotoLibraryRestoreV1(), stop = new AbortController(); let reads = 0, retired = 0, loaded = 0;
	const reason = 17, request = { blob: file(), signal: stop.signal, retireAndJoin: async () => { retired++; }, loadRuntime: async () => { loaded++; return runtime(); } };
	const input = new Proxy(request, { getOwnPropertyDescriptor(target, key) {
		if (key === 'retireAndJoin' && ++reads === 3) stop.abort(reason); return Reflect.getOwnPropertyDescriptor(target, key);
	} });
	await assert.rejects(owner.start(input), error => error === reason);
	assert.equal(retired, 0); assert.equal(loaded, 0); await owner.close();
});
