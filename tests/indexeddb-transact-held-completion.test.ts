/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

async function heldOperation(nativeFailure?: Error, callbackFailure?: unknown) {
	const raw = createInstrumentedIndexedDB(), database = await openDatabase(raw as unknown as IDBFactory, 'held-completion');
	const entered = deferred<IDBTransaction>(), release = deferred<void>(), unhandled: unknown[] = [];
	const observe = (reason: unknown): void => { unhandled.push(reason); };
	process.on('unhandledRejection', observe);
	if (nativeFailure) raw.failNextPutForStore('settings', nativeFailure);
	let result: unknown, failed = false;
	const work = transact(database, 'settings', 'readwrite', async (stores, transaction) => {
		if (nativeFailure) stores.settings!.put({ key: 'candidate', value: true });
		entered.resolve(transaction); await release.promise;
		if (callbackFailure !== undefined) throw callbackFailure;
		return 'callback completed';
	});
	const joined = work.then(value => { result = value; }, (error: unknown) => { failed = true; result = error; });
	try {
		const transaction = await entered.promise;
		if (!nativeFailure) transaction.abort();
		await settle();
		assert.equal(raw.stats.activeTransactions, 0, 'native completion precedes the held callback');
		assert.equal(await remainsPending(joined), true, 'completion must still join the admitted callback');
		assert.deepEqual(unhandled, [], 'completion rejection is observed immediately');
		release.resolve(); await joined;
		assert.equal(failed, true, 'native failure must not become a successful callback result');
		if (callbackFailure !== undefined) assert.equal(result, callbackFailure);
		else if (nativeFailure) assert.equal((result as Error).message, 'The IndexedDB transaction failed.');
		else assert.match((result as Error).message, /transaction was aborted/u);
		assert.deepEqual(raw.records('held-completion', 'settings'), []);
		await settle(); assert.deepEqual(unhandled, []);
	} finally {
		release.resolve(); await joined; process.removeListener('unhandledRejection', observe); database.close();
	}
}

test('transact observes native abort immediately while joining a held successful callback', async () => {
	await heldOperation();
});

test('transact propagates native completion failure after joining a held successful callback', async () => {
	await heldOperation(new Error('native put refused'));
});

test('a held callback failure remains primary after an earlier native completion failure', async () => {
	let inspected = 0;
	const opaque = new Proxy({}, { get() { inspected++; throw new Error('opaque'); },
		getPrototypeOf() { inspected++; throw new Error('opaque'); } });
	await heldOperation(new Error('native put refused'), opaque); assert.equal(inspected, 0);
});

test('an immediate callback failure still joins a held native abort event', async () => {
	const raw = createInstrumentedIndexedDB(), database = await openDatabase(raw as unknown as IDBFactory, 'held-abort-event');
	const transaction = database.transaction.bind(database), entered = deferred<void>(), release = deferred<void>();
	const primary = Object.freeze({ callback: 'refused' }); let failure: unknown;
	database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
		const current = transaction(...args); let abort: IDBTransaction['onabort'] = null;
		Object.defineProperty(current, 'onabort', { configurable: true, set(value: IDBTransaction['onabort']) { abort = value; },
			get() { return (event: Event) => { entered.resolve(); void release.promise.then(() => abort?.call(current, event)); }; } });
		return current;
	}) as IDBDatabase['transaction'];
	const work = transact(database, 'settings', 'readwrite', () => { throw primary; }).catch((error: unknown) => { failure = error; });
	try {
		await entered.promise; assert.equal(await remainsPending(work), true);
		release.resolve(); await work; assert.equal(failure, primary); assert.equal(raw.stats.activeTransactions, 0);
	} finally { release.resolve(); await work; database.transaction = transaction; database.close(); }
});
