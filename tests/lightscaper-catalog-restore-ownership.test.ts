/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createPhotoCatalogRestoreStageV1 } from '../src/lightscaper/catalog/photo-catalog-restore-stage-v1.ts';
import { PHOTO_CATALOG_STORES } from '../src/lightscaper/catalog/repository-types.ts';
import { PHOTO_CATALOG_RESTORE_OWNER_STORE_V1 as OWNER_STORE, PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1 as OWNER_KEY,
	photoLibraryRestoreNamespacesV1, photoLibraryRestoreOwnerMarkerV1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { savedArchiveRootV3 } from './helpers/lightscaper-saved-collection-archive-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });

const allocation = { schemaVersion: 1 as const, kind: 'photo-library-restore-allocation' as const,
	operationId: 'a'.repeat(32), namespaceToken: 'a'.repeat(32), ownerToken: 'b'.repeat(32), catalogId: 'catalog-1' };
const databaseName = photoLibraryRestoreNamespacesV1(allocation).catalogDatabaseName;
const marker = photoLibraryRestoreOwnerMarkerV1(allocation, 'catalog');
const root = savedArchiveRootV3(0);
function fixture() {
	const raw = createInstrumentedIndexedDB(), deleted: string[] = [], opens: (number | undefined)[] = [];
	const ownerProfile = { autoIncrement: false, indexCount: 0 }, decorated = new WeakSet<IDBDatabase>();
	// The generic fake omits these readonly DOM metadata properties. This local bridge supplies
	// the creator's false/empty defaults; it never changes requests, rows or transaction settlement.
	const decorate = (database: IDBDatabase): void => {
		if (decorated.has(database)) return; decorated.add(database);
		const transaction = database.transaction.bind(database);
		database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
			const current = transaction(...args), objectStore = current.objectStore.bind(current);
			current.objectStore = name => {
				const store = objectStore(name);
				if (name === OWNER_STORE) {
					Object.defineProperty(store, 'autoIncrement', { configurable: true, value: ownerProfile.autoIncrement });
					Object.defineProperty(store.indexNames, 'length', { configurable: true, value: ownerProfile.indexCount });
				}
				return store;
			}; return current;
		}) as IDBDatabase['transaction'];
	};
	const factory = { open(name: string, version?: number) {
		opens.push(version); const opening = raw.open(name, version); let current: IDBDatabase | null = null;
		Object.defineProperty(opening, 'result', { configurable: true, set(value: IDBDatabase) { current = value; decorate(value); }, get() { return current; } });
		return opening;
	},
		deleteDatabase(name: string) {
			deleted.push(name); const removal = { onsuccess: null as IDBOpenDBRequest['onsuccess'], onerror: null, onblocked: null, error: null };
			queueMicrotask(() => removal.onsuccess?.call(removal as unknown as IDBOpenDBRequest, new Event('success'))); return removal;
		} } as unknown as IDBFactory;
	return { raw, factory, deleted, opens, ownerProfile };
}
function options(f: ReturnType<typeof fixture>) { return { indexedDB: f.factory, databaseName, root, savedState: null, restoreAllocation: allocation }; }
async function inspect(f: ReturnType<typeof fixture>, signal?: AbortSignal) {
	const { inspectPhotoCatalogRestoreNamespaceV1 } = await import('../src/lightscaper/catalog/photo-catalog-restore-owner-v1.ts');
	return inspectPhotoCatalogRestoreNamespaceV1({ indexedDB: f.factory, allocation, signal });
}
function holdOpen(f: ReturnType<typeof fixture>, observe?: (database: IDBDatabase) => void) {
	const entered = deferred<void>(), release = deferred<void>(), open = f.factory.open.bind(f.factory); let held = false;
	f.factory.open = ((name: string, version?: number) => {
		const opening = open(name, version);
		if (!held) {
			held = true; let success: IDBOpenDBRequest['onsuccess'] = null;
			Object.defineProperty(opening, 'onsuccess', { configurable: true,
				set(value: IDBOpenDBRequest['onsuccess']) { success = value; }, get() { return (event: Event) => {
					observe?.(opening.result); entered.resolve(); void release.promise.then(() => success?.call(opening, event));
				}; } });
		}
		return opening;
	}) as IDBFactory['open'];
	return { entered: entered.promise, release: () => { release.resolve(); }, restore: () => { f.factory.open = open; } };
}
function open(f: ReturnType<typeof fixture>, version?: number, upgrade?: (database: IDBDatabase) => void): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const opening = f.factory.open(databaseName, version);
		opening.onupgradeneeded = () => { upgrade?.(opening.result); };
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
	});
}

test('owner marker commits in fresh native creation before stage initialization can start', async () => {
	const f = fixture(), observed: unknown[][] = [], gate = holdOpen(f, current => {
		assert.equal(current.version, 5); assert.equal([...current.objectStoreNames].length, 16);
		observed.push(f.raw.records(databaseName, OWNER_STORE), f.raw.records(databaseName, 'catalogs'));
	});
	const work = createPhotoCatalogRestoreStageV1(options(f));
	try {
		await Promise.race([gate.entered, work]);
		assert.deepEqual(observed, [[marker], []]); assert.equal(await remainsPending(work), true);
		await assert.rejects(createPhotoCatalogRestoreStageV1(options(f)), /already owns/iu);
		gate.release(); const stage = await work; await stage.finish(); await stage.close();
		assert.equal(await inspect(f), 'owned'); assert.deepEqual(f.deleted, []);
	} finally { gate.release(); await work.then(stage => stage.close(), () => undefined); gate.restore(); }
});

test('a failed marker add aborts every fresh schema store atomically', async () => {
	const f = fixture(), nativeOpen = f.factory.open.bind(f.factory);
	f.factory.open = ((name: string, version?: number) => {
		const opening = nativeOpen(name, version); let upgrade: IDBOpenDBRequest['onupgradeneeded'] = null;
		Object.defineProperty(opening, 'onupgradeneeded', { configurable: true,
			set(value: IDBOpenDBRequest['onupgradeneeded']) { upgrade = value; }, get() { return (event: IDBVersionChangeEvent) => {
				const create = opening.result.createObjectStore.bind(opening.result);
				opening.result.createObjectStore = ((storeName: string, config?: IDBObjectStoreParameters) => {
					const store = create(storeName, config); if (storeName === OWNER_STORE) store.add(marker); return store;
				}) as IDBDatabase['createObjectStore']; upgrade?.call(opening, event);
			}; } }); return opening;
	}) as IDBFactory['open'];
	await assert.rejects(createPhotoCatalogRestoreStageV1(options(f)), /Constraint|already contains/iu);
	assert.deepEqual(f.deleted, []); assert.equal(f.raw.stats.activeTransactions, 0);
	for (const store of [...PHOTO_CATALOG_STORES, OWNER_STORE]) assert.equal(f.raw.recordCount(databaseName, store), 0);
	f.factory.open = nativeOpen; assert.equal(await inspect(f), 'absent');
});

test('closed allocation and selected catalog/location mismatches refuse before opening', async () => {
	const f = fixture(); let gets = 0;
	for (const restoreAllocation of [{ ...allocation, catalogId: 'foreign' }, { ...allocation, extra: true },
		{ ...allocation, get ownerToken() { gets++; throw new Error('Getter invoked.'); } }]) {
		await assert.rejects(createPhotoCatalogRestoreStageV1({ ...options(f), restoreAllocation }));
	}
	await assert.rejects(createPhotoCatalogRestoreStageV1({ ...options(f), databaseName: 'unbound-name' }));
	assert.equal(gets, 0); assert.deepEqual(f.opens, []); assert.deepEqual(f.deleted, []);
});

test('allocation is detached before the held factory request and default DB5 remains fifteen stores', async () => {
	const f = fixture(), raw = { ...allocation }, gate = holdOpen(f);
	const work = createPhotoCatalogRestoreStageV1({ ...options(f), restoreAllocation: raw });
	try {
		await Promise.race([gate.entered, work]); raw.ownerToken = 'c'.repeat(32); gate.release();
		const stage = await work; assert.deepEqual(f.raw.records(databaseName, OWNER_STORE), [marker]); await stage.close();
	} finally { gate.release(); await work.then(stage => stage.close(), () => undefined); gate.restore(); }
	const plain = fixture(), stage = await createPhotoCatalogRestoreStageV1({ indexedDB: plain.factory, databaseName, root, savedState: null });
	const current = await open(plain); assert.deepEqual([...current.objectStoreNames].sort(), [...PHOTO_CATALOG_STORES].sort());
	await stage.close(); current.close(); assert.equal(await inspect(plain), 'foreign');
});

for (const corruption of ['missing', 'mismatch', 'extra'] as const) test(`owner ${corruption} prevents readiness without exempting foreign keys`, async () => {
	const f = fixture(), stage = await createPhotoCatalogRestoreStageV1(options(f));
	try {
		if (corruption === 'missing') {
			const current = await open(f); await new Promise<void>((resolve, reject) => {
				const transaction = current.transaction(OWNER_STORE, 'readwrite'); transaction.objectStore(OWNER_STORE).delete(OWNER_KEY);
				transaction.oncomplete = () => { resolve(); }; transaction.onabort = () => { reject(transaction.error); };
			}); current.close();
		} else f.raw.seedRecord(databaseName, OWNER_STORE, corruption === 'extra' ? { ...marker, key: 'foreign' } : { ...marker, ownerToken: 'c'.repeat(32) });
		assert.equal(await inspect(f), 'foreign'); await assert.rejects(stage.finish(), /owner|allocation/iu);
		assert.equal(f.raw.records(databaseName, 'photoQueryBuildStatesV2')[0].ready, false);
	} finally { await stage.close(); }
});

test('final readiness transaction includes the owner marker and refuses late marker drift', async () => {
	const f = fixture(), gate = holdOpen(f, database => {
		const transaction = database.transaction.bind(database);
		database.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
			const stores = typeof names === 'string' ? [names] : names;
			if (mode === 'readwrite' && stores.includes(OWNER_STORE)) {
				assert.equal(stores.length, 16); f.raw.seedRecord(databaseName, OWNER_STORE, { ...marker, ownerToken: 'c'.repeat(32) });
			}
			return transaction(names, mode);
		}) as IDBDatabase['transaction'];
	});
	const work = createPhotoCatalogRestoreStageV1(options(f));
	try {
		await Promise.race([gate.entered, work]); gate.release(); const stage = await work;
		await assert.rejects(stage.finish(), /owner|allocation/iu); assert.equal(f.raw.records(databaseName, 'photoQueryBuildStatesV2')[0].ready, false);
		await stage.close();
	} finally { gate.release(); await work.then(stage => stage.close(), () => undefined); gate.restore(); }
});

test('absent inspection aborts its upgrade without creating stores or deleting', async () => {
	const f = fixture(); assert.equal(await inspect(f), 'absent'); assert.deepEqual(f.opens, [undefined]);
	assert.deepEqual(f.deleted, []); assert.equal(f.raw.stats.activeTransactions, 0);
	const current = await open(f, 5); assert.deepEqual([...current.objectStoreNames], []); current.close();
});

for (const version of [4, 6]) test(`DB${version} inspection is foreign without migration or adoption`, async () => {
	const f = fixture(), current = await open(f, version, database => {
		database.createObjectStore('prior', { keyPath: 'key' }).add({ key: 'untouched', text: 'e\u0301\ud800' });
	});
	const before = f.raw.records(databaseName, 'prior'); assert.equal(await inspect(f), 'foreign');
	assert.equal(current.version, version); assert.deepEqual([...current.objectStoreNames], ['prior']);
	assert.deepEqual(f.raw.records(databaseName, 'prior'), before); assert.deepEqual(f.deleted, []); current.close();
});

test('unknown companion profile refuses ownership even with an exact marker', async () => {
	const f = fixture(), stage = await createPhotoCatalogRestoreStageV1(options(f)); await stage.close();
	const current = await open(f); const stores = [...current.objectStoreNames];
	let delivered = 0;
	Object.defineProperty(current, 'objectStoreNames', { configurable: true, value: { *[Symbol.iterator]() {
		for (const store of stores) { delivered++; yield store; }
		delivered++; yield 'foreign'; delivered++; throw new Error('Inspection continued after a foreign seventeenth store.');
	} } });
	assert.equal(await inspect(f), 'foreign'); assert.equal(delivered, 17); assert.equal(f.raw.stats.getAllRequests.length, 0);
	assert.equal(f.raw.stats.cursorRequests.length, 0); assert.equal(f.raw.stats.keyCursorRequests.length, 0); current.close();
});

test('the owner key is never exempted from an ordinary catalog-store inventory', async () => {
	const f = fixture(), stage = await createPhotoCatalogRestoreStageV1(options(f));
	try {
		f.raw.seedRecord(databaseName, 'photoSmartCollectionStates', marker, OWNER_KEY);
		await assert.rejects(stage.finish(), /inventory|count|physical/iu);
		assert.equal(f.raw.records(databaseName, 'photoQueryBuildStatesV2')[0].ready, false);
	} finally { await stage.close(); }
});

for (const closeFirst of [false, true]) test(`rollback refuses a foreign same-name owner after prior close=${closeFirst}`, async () => {
	const f = fixture(), stage = await createPhotoCatalogRestoreStageV1(options(f));
	if (closeFirst) await stage.close();
	const foreign = { ...marker, ownerToken: 'c'.repeat(32) }; f.raw.seedRecord(databaseName, OWNER_STORE, foreign);
	await assert.rejects(stage.rollback(), /owner|foreign|allocation/iu);
	assert.deepEqual(f.deleted, []); assert.deepEqual(f.raw.records(databaseName, OWNER_STORE), [foreign]);
	assert.deepEqual(f.raw.records(databaseName, 'catalogs'), [root]); assert.equal(f.raw.stats.activeTransactions, 0);
});

test('owned cleanup uses its captured factory methods despite an aborted lifetime and later replacement', async () => {
	const f = fixture(), stop = new AbortController(), stage = await createPhotoCatalogRestoreStageV1({ ...options(f), signal: stop.signal });
	await stage.close(); stop.abort(null);
	f.factory.open = () => { throw new Error('Replacement opener was called.'); };
	f.factory.deleteDatabase = () => { throw new Error('Replacement deleter was called.'); };
	await stage.rollback(); assert.deepEqual(f.deleted, [databaseName]); assert.equal(f.raw.stats.activeTransactions, 0);
});

test('close-first rollback holds the reclaimed name through its native ownership probe', async () => {
	const f = fixture(), nativeOpen = f.factory.open.bind(f.factory), entered = deferred<void>(), release = deferred<void>(); let hold = false;
	f.factory.open = ((name: string, version?: number) => {
		const opening = nativeOpen(name, version);
		if (hold) {
			let success: IDBOpenDBRequest['onsuccess'] = null;
			Object.defineProperty(opening, 'onsuccess', { configurable: true,
				set(value: IDBOpenDBRequest['onsuccess']) { success = value; }, get() { return (event: Event) => {
					entered.resolve(); void release.promise.then(() => success?.call(opening, event));
				}; } });
		}
		return opening;
	}) as IDBFactory['open'];
	const stage = await createPhotoCatalogRestoreStageV1(options(f)); await stage.close(); hold = true; const work = stage.rollback();
	try {
		await Promise.race([entered.promise, work]); assert.equal(await remainsPending(work), true); assert.deepEqual(f.deleted, []);
		const opens = f.opens.length; await assert.rejects(createPhotoCatalogRestoreStageV1(options(f)), /already owns/iu);
		assert.equal(f.opens.length, opens); release.resolve(); await work; assert.deepEqual(f.deleted, [databaseName]);
	} finally { release.resolve(); await work; }
});

for (const profile of [{ autoIncrement: true, indexCount: 0 }, { autoIncrement: false, indexCount: 1 }]) {
	test(`companion autoIncrement=${profile.autoIncrement}/indexes=${profile.indexCount} is foreign and cannot finish`, async () => {
		const f = fixture(), stage = await createPhotoCatalogRestoreStageV1(options(f)); Object.assign(f.ownerProfile, profile);
		try {
			assert.equal(await inspect(f), 'foreign'); await assert.rejects(stage.finish(), /owner|profile/iu);
			assert.equal(f.raw.records(databaseName, 'photoQueryBuildStatesV2')[0].ready, false);
		} finally { await stage.close(); }
	});
}

test('inspection closes malformed options and native signals before the first open', async () => {
	const f = fixture(), { inspectPhotoCatalogRestoreNamespaceV1 } = await import('../src/lightscaper/catalog/photo-catalog-restore-owner-v1.ts');
	let gets = 0;
	for (const value of [{ indexedDB: f.factory, allocation, extra: true }, { indexedDB: f.factory, get allocation() { gets++; throw new Error('Getter invoked.'); } },
		{ indexedDB: f.factory, allocation, signal: {} }]) {
		await assert.rejects(inspectPhotoCatalogRestoreNamespaceV1(value as unknown as Parameters<typeof inspectPhotoCatalogRestoreNamespaceV1>[0]));
	}
	const stop = new AbortController(), reason = Object.freeze({ cancelled: true }); stop.abort(reason);
	let failure: unknown; await inspectPhotoCatalogRestoreNamespaceV1({ indexedDB: f.factory, allocation, signal: stop.signal }).catch((error: unknown) => { failure = error; });
	assert.equal(failure, reason); assert.equal(gets, 0); assert.deepEqual(f.opens, []); assert.deepEqual(f.deleted, []);
});

test('inspection joins a held open and propagates an opaque late native reason without inspection', async () => {
	const f = fixture(), stage = await createPhotoCatalogRestoreStageV1(options(f)); await stage.close();
	const gate = holdOpen(f), stop = new AbortController(); let inspections = 0, failure: unknown;
	const reason = new Proxy({}, { getPrototypeOf() { inspections++; throw new Error('Opaque prototype.'); }, get() { inspections++; throw new Error('Opaque value.'); } });
	const work = inspect(f, stop.signal).catch((error: unknown) => { failure = error; });
	try {
		await gate.entered; Object.defineProperty(stop.signal, 'reason', { get() { inspections++; throw new Error('Caller signal getter.'); } });
		stop.abort(reason); assert.equal(await remainsPending(work), true); gate.release(); await work;
		assert.equal(failure, reason); assert.equal(inspections, 0); assert.deepEqual(f.deleted, []); assert.equal(f.raw.stats.activeTransactions, 0);
	} finally { gate.release(); await work; gate.restore(); }
});

test('inspection cancellation joins the held owner point read before closing its borrowed connection', async () => {
	const f = fixture(), stage = await createPhotoCatalogRestoreStageV1(options(f)); await stage.close();
	const current = await open(f), transaction = current.transaction.bind(current), close = current.close.bind(current);
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Object.freeze({ pointRead: 'cancelled' });
	let closed = 0, failure: unknown;
	current.close = () => { closed++; close(); };
	current.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
		const result = transaction(names, mode), store = result.objectStore(OWNER_STORE), get = store.get.bind(store);
		store.get = ((key: IDBValidKey | IDBKeyRange) => {
			const reading = get(key); let success: IDBRequest['onsuccess'] = null;
			Object.defineProperty(reading, 'onsuccess', { configurable: true,
				set(value: IDBRequest['onsuccess']) { success = value; }, get() { return (event: Event) => {
					entered.resolve(); void release.promise.then(() => success?.call(reading, event));
				}; } }); return reading;
		}) as IDBObjectStore['get'];
		const objectStore = result.objectStore.bind(result);
		result.objectStore = name => name === OWNER_STORE ? store : objectStore(name); return result;
	}) as IDBDatabase['transaction'];
	const work = inspect(f, stop.signal).catch((error: unknown) => { failure = error; });
	try {
		await Promise.race([entered.promise, work]); stop.abort(reason);
		assert.equal(await remainsPending(work), true); assert.equal(closed, 0); release.resolve(); await work;
		assert.equal(failure, reason); assert.equal(closed, 1); assert.equal(f.raw.stats.activeTransactions, 0); assert.deepEqual(f.deleted, []);
	} finally { release.resolve(); await work; current.transaction = transaction; current.close = close; close(); }
});

test('native owned-profile readiness ACK wins late cancellation and close joins its delivery', async () => {
	const f = fixture(), stop = new AbortController(), stage = await createPhotoCatalogRestoreStageV1({ ...options(f), signal: stop.signal });
	const current = await open(f), transaction = current.transaction.bind(current), entered = deferred<void>(), release = deferred<void>();
	current.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
		const result = transaction(names, mode), stores = typeof names === 'string' ? [names] : names;
		if (mode === 'readwrite' && stores.includes(OWNER_STORE)) {
			assert.equal(stores.length, 16); let complete: IDBTransaction['oncomplete'] = null;
			Object.defineProperty(result, 'oncomplete', { configurable: true,
				set(value: IDBTransaction['oncomplete']) { complete = value; }, get() { return (event: Event) => {
					stop.abort(null); entered.resolve(); void release.promise.then(() => complete?.call(result, event));
				}; } });
		}
		return result;
	}) as IDBDatabase['transaction'];
	const work = stage.finish();
	try {
		await Promise.race([entered.promise, work]); const closing = stage.close();
		assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true);
		release.resolve(); assert.equal((await work).catalogRevision, root.revision); await closing;
		assert.equal(f.raw.records(databaseName, 'photoQueryBuildStatesV2')[0].ready, true);
		assert.deepEqual(f.raw.records(databaseName, OWNER_STORE), [marker]); assert.deepEqual(f.deleted, []);
	} finally { release.resolve(); await work; current.transaction = transaction; await stage.close(); current.close(); }
});
