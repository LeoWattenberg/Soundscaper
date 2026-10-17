/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readPhotoQueryPageV2 } from '../src/lightscaper/catalog/photo-query-pages-v2.ts';
import { normalizePhotoCatalogQueryV2, photoQueryDigestV2 } from '../src/lightscaper/catalog/photo-query-types-v2.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { SMART_COLLECTION_TEST_DATABASE as DB, smartCollectionRepositoryFixtureV1 } from './helpers/lightscaper-smart-collection-repository-fixture.ts';
import { deferred, remainsPending, settle } from './helpers/async-test-control.ts';

type Fixture = Awaited<ReturnType<typeof prepare>>;
const stores = ['catalogs', 'catalogStates', 'photoQueryRowsV2', 'photoQueryBuildStatesV2'];
const query = normalizePhotoCatalogQueryV2({ schemaVersion: 2, kind: 'photo-catalog-query', text: 'Sparse needle' });

async function prepare() {
	const f = await smartCollectionRepositoryFixtureV1();
	await f.repository.publishPhotos('catalog', 0, [queryPhotoV1(0), queryPhotoV1(1)]);
	return f;
}
async function close(f: Fixture) { f.database.close(); await f.repository.close(); }

/** Delay only the delivered callbacks; native requests, abort and completion still run. */
function observe(f: Fixture, options: Readonly<{ holdRequest?: string; holdCompletion?: boolean; throwGet?: string; failure?: unknown }> = {}) {
	const transaction = f.database.transaction, entered = deferred<void>(), release = deferred<void>();
	const completed = deferred<void>(), releaseCompletion = deferred<void>();
	const queued: string[] = [], profiles: { names: string[]; mode: IDBTransactionMode | undefined }[] = [];
	const unhandled: unknown[] = [], onUnhandled = (reason: unknown): void => { unhandled.push(reason); };
	process.on('unhandledRejection', onUnhandled);
	f.database.transaction = ((names: string | readonly string[], mode?: IDBTransactionMode) => {
		profiles.push({ names: typeof names === 'string' ? [names] : [...names], mode });
		const current = transaction.call(f.database, names, mode), objectStore = current.objectStore.bind(current);
		if (options.holdCompletion) for (const name of ['oncomplete', 'onabort', 'onerror'] as const) {
			let callback: IDBTransaction['oncomplete'] = null;
			Object.defineProperty(current, name, { configurable: true,
				set(value: IDBTransaction['oncomplete']) { callback = value; },
				get() { return (event: Event): void => { completed.resolve(); void releaseCompletion.promise.then(() => { callback?.call(current, event); }); }; },
			});
		}
		current.objectStore = name => {
			const store = objectStore(name), get = store.get.bind(store);
			store.get = ((key: IDBValidKey | IDBKeyRange) => {
				queued.push(name);
				if (options.throwGet === name) throw options.failure;
				const reading: IDBRequest<unknown> = get(key);
				if (options.holdRequest === name) for (const eventName of ['onsuccess', 'onerror'] as const) {
					let callback: IDBRequest<unknown>['onsuccess'] = null;
					Object.defineProperty(reading, eventName, { configurable: true,
						set(value: IDBRequest<unknown>['onsuccess']) { callback = value; },
						get() { return (event: Event): void => { entered.resolve(); void release.promise.then(() => { callback?.call(reading, event); }); }; },
					});
				}
				return reading;
			}) as IDBObjectStore['get'];
			return store;
		};
		return current;
	}) as IDBDatabase['transaction'];
	return { queued, profiles, entered, release, completed, releaseCompletion, unhandled,
		restore() { release.resolve(); releaseCompletion.resolve(); f.database.transaction = transaction; process.removeListener('unhandledRejection', onUnhandled); },
	};
}

function outcome<Value>(work: Promise<Value>) {
	let settled = false, failure: unknown, result: Value | undefined, rejected = false;
	const joined = work.then(value => { settled = true; result = value; }, (error: unknown) => { settled = true; rejected = true; failure = error; });
	return { joined, get settled() { return settled; }, get rejected() { return rejected; }, get failure() { return failure; }, get result() { return result; } };
}

test('root and index requests queue in one native transaction before the held index callback', async () => {
	const f = await prepare(), observer = observe(f, { holdRequest: 'catalogStates' });
	const read = outcome(readPhotoQueryPageV2(f.database, 'catalog', { query }));
	try {
		await observer.entered.promise;
		assert.deepEqual(observer.queued, ['catalogStates', 'catalogs']);
		assert.equal(read.settled, false); assert.equal(f.indexedDB.stats.activeTransactions, 1);
		observer.release.resolve(); await read.joined;
		assert.equal(read.rejected, false); assert.deepEqual(read.result?.items.map(row => row.photoId), [queryPhotoV1(0).id]);
		assert.equal(read.result?.scanned, 2); assert.equal(read.result?.continuation, null);
		assert.deepEqual(observer.queued, ['catalogStates', 'catalogs', 'photoQueryBuildStatesV2']);
		assert.deepEqual(observer.profiles, [{ names: stores, mode: 'readonly' }]);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { observer.release.resolve(); await read.joined; observer.restore(); await close(f); }
});

for (const held of ['catalogStates', 'catalogs']) test(`a failing context read joins the held ${held} callback and native abort receipt`, async () => {
	const f = await prepare(), observer = observe(f, { holdRequest: held, holdCompletion: true });
	const failed = held === 'catalogStates' ? 'catalogs' : 'catalogStates', primary = new Error(`Native ${failed} read refused.`);
	f.indexedDB.onNextGetForStore(failed, () => { throw primary; });
	const cursorCount = f.indexedDB.stats.cursorRequests.length;
	const read = outcome(readPhotoQueryPageV2(f.database, 'catalog', { query }));
	try {
		await settle(); assert.deepEqual(observer.queued, ['catalogStates', 'catalogs']);
		await observer.entered.promise; await observer.completed.promise;
		assert.equal(await remainsPending(read.joined), true);
		observer.release.resolve(); await settle(); assert.equal(await remainsPending(read.joined), true);
		observer.releaseCompletion.resolve(); await read.joined;
		assert.equal(read.rejected, true);
		assert.equal(read.failure, primary);
		assert.equal(f.indexedDB.stats.cursorRequests.length, cursorCount);
		assert.equal(f.indexedDB.stats.activeTransactions, 0); assert.deepEqual(observer.unhandled, []);
	} finally { observer.release.resolve(); observer.releaseCompletion.resolve(); await read.joined; observer.restore(); await close(f); }
});

test('synchronous second-request refusal still owns a later rejecting first callback and completion', async () => {
	const f = await prepare(), primary = Object.freeze({ source: 'root request construction' }), late = new Error('First queued request failed later.');
	const observer = observe(f, { holdRequest: 'catalogStates', holdCompletion: true, throwGet: 'catalogs', failure: primary });
	f.indexedDB.onNextGetForStore('catalogStates', () => { throw late; });
	const cursorCount = f.indexedDB.stats.cursorRequests.length;
	const read = outcome(readPhotoQueryPageV2(f.database, 'catalog', { query }));
	try {
		await settle(); assert.deepEqual(observer.queued, ['catalogStates', 'catalogs']);
		await observer.entered.promise; await observer.completed.promise;
		assert.equal(await remainsPending(read.joined), true); assert.deepEqual(observer.unhandled, []);
		observer.release.resolve(); await settle(); assert.equal(await remainsPending(read.joined), true);
		observer.releaseCompletion.resolve(); await read.joined;
		assert.equal(read.rejected, true); assert.equal(read.failure, primary);
		assert.equal(f.indexedDB.stats.cursorRequests.length, cursorCount);
		assert.equal(f.indexedDB.stats.activeTransactions, 0); assert.deepEqual(observer.unhandled, []);
	} finally { observer.release.resolve(); observer.releaseCompletion.resolve(); await read.joined; observer.restore(); await close(f); }
});

test('cancelled context reads retain opaque native reason and join both callbacks and completion', async () => {
	const f = await prepare(), observer = observe(f, { holdRequest: 'catalogStates', holdCompletion: true });
	let inspected = 0;
	const reason = new Proxy({}, { get() { inspected++; throw new Error('Opaque property.'); }, getPrototypeOf() { inspected++; throw new Error('Opaque prototype.'); } });
	const stop = new AbortController(), cursorCount = f.indexedDB.stats.cursorRequests.length;
	const read = outcome(readPhotoQueryPageV2(f.database, 'catalog', { query, signal: stop.signal }));
	try {
		await observer.entered.promise; assert.deepEqual(observer.queued, ['catalogStates', 'catalogs']); stop.abort(reason);
		Object.defineProperty(stop.signal, 'aborted', { get() { inspected++; throw new Error('Shadowed original signal.'); } });
		await observer.completed.promise; assert.equal(await remainsPending(read.joined), true);
		observer.release.resolve(); await settle(); assert.equal(await remainsPending(read.joined), true);
		observer.releaseCompletion.resolve(); await read.joined;
		assert.equal(read.rejected, true); assert.equal(read.failure, reason); assert.equal(inspected, 0);
		assert.equal(f.indexedDB.stats.cursorRequests.length, cursorCount); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		assert.deepEqual(observer.unhandled, []);
	} finally { observer.release.resolve(); observer.releaseCompletion.resolve(); await read.joined; observer.restore(); await close(f); }
});

test('a successful page is not delivered until its actual native completion receipt', async () => {
	const f = await prepare(), observer = observe(f, { holdCompletion: true });
	const read = outcome(readPhotoQueryPageV2(f.database, 'catalog', { query }));
	try {
		await observer.completed.promise; assert.equal(f.indexedDB.stats.activeTransactions, 0);
		assert.equal(await remainsPending(read.joined), true);
		observer.releaseCompletion.resolve(); await read.joined;
		assert.equal(read.rejected, false); assert.deepEqual(read.result?.items.map(row => row.photoId), [queryPhotoV1(0).id]);
		assert.deepEqual(observer.queued, ['catalogStates', 'catalogs', 'photoQueryBuildStatesV2']);
		assert.deepEqual(observer.profiles, [{ names: stores, mode: 'readonly' }]); assert.deepEqual(observer.unhandled, []);
	} finally { observer.releaseCompletion.resolve(); await read.joined; observer.restore(); await close(f); }
});

test('malformed, foreign and disagreeing context refuses before build or cursor with all source bytes unchanged', async () => {
	for (const corruption of ['root-shape', 'root-foreign', 'state-shape', 'state-foreign', 'root-revision', 'photo-count', 'root-missing', 'state-missing']) {
		const f = await prepare();
		const root = f.indexedDB.records(DB, 'catalogs')[0] as Record<string, unknown>;
		const state = f.indexedDB.records(DB, 'catalogStates')[0] as Record<string, unknown>;
		if (corruption.endsWith('missing')) await f.mutate(corruption === 'root-missing' ? 'catalogs' : 'catalogStates', async store => { await f.request(store.delete('catalog')); });
		else if (corruption.startsWith('root')) f.indexedDB.seedRecord(DB, 'catalogs', { ...root,
			...(corruption === 'root-shape' ? { future: true } : corruption === 'root-foreign' ? { id: 'foreign' } : { revision: 2 }) }, 'catalog');
		else f.indexedDB.seedRecord(DB, 'catalogStates', { ...state,
			...(corruption === 'state-shape' ? { future: true } : corruption === 'state-foreign' ? { id: 'foreign' } : { photoCount: 3 }) }, 'catalog');
		const before = stores.map(name => f.indexedDB.records(DB, name)), cursorCount = f.indexedDB.stats.cursorRequests.length;
		const observer = observe(f);
		try {
			await assert.rejects(readPhotoQueryPageV2(f.database, 'catalog', { query }));
			assert.deepEqual(observer.queued, ['catalogStates', 'catalogs']);
			assert.equal(f.indexedDB.stats.cursorRequests.length, cursorCount); assert.equal(f.indexedDB.stats.activeTransactions, 0);
			assert.deepEqual(stores.map(name => f.indexedDB.records(DB, name)), before);
		} finally { observer.restore(); await close(f); }
	}
});

test('stale continuation and unready or mismatched builds keep their existing admission order', async () => {
	for (const corruption of ['continuation', 'unready', 'build-count', 'digest']) {
		const f = await prepare(), build = f.indexedDB.records(DB, 'photoQueryBuildStatesV2')[0] as Record<string, unknown>;
		if (corruption === 'unready' || corruption === 'build-count') f.indexedDB.seedRecord(DB, 'photoQueryBuildStatesV2', { ...build,
			...(corruption === 'unready' ? { ready: false } : { indexedCount: 3 }) }, 'catalog');
		const continuation = corruption === 'continuation' || corruption === 'digest' ? { schemaVersion: 2 as const, kind: 'photo-query' as const,
			catalogId: 'catalog', catalogRevision: 0, indexRevision: 0, querySha256: corruption === 'digest' ? '0'.repeat(64) : photoQueryDigestV2(query), captureBucket: 0 as const, afterKey: null } : null;
		const cursorCount = f.indexedDB.stats.cursorRequests.length, observer = observe(f);
		try {
			await assert.rejects(readPhotoQueryPageV2(f.database, 'catalog', { query, continuation }));
			assert.deepEqual(observer.queued, corruption === 'digest' ? [] : corruption === 'continuation'
				? ['catalogStates', 'catalogs'] : ['catalogStates', 'catalogs', 'photoQueryBuildStatesV2']);
			assert.equal(f.indexedDB.stats.cursorRequests.length, cursorCount); assert.equal(f.indexedDB.stats.activeTransactions, 0);
		} finally { observer.restore(); await close(f); }
	}
});
