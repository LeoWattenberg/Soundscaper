/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoMediaRestoreNamespaceV1, inspectPhotoMediaRestoreNamespaceV1 } from '../src/lightscaper/storage/photo-media-restore-namespace-v1.ts';
import { PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1, photoLibraryRestoreNamespacesV1,
	photoLibraryRestoreOwnerMarkerV1 } from '../src/lightscaper/storage/photo-library-restore-ownership-v1.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const allocation = () => ({ schemaVersion: 1 as const, kind: 'photo-library-restore-allocation' as const,
	operationId: 'a'.repeat(32), namespaceToken: 'a'.repeat(32), ownerToken: 'b'.repeat(32), catalogId: 'catalog-1' });
const name = () => photoLibraryRestoreNamespacesV1(allocation()).mediaDatabaseName;
const STORES = ['analysis', 'catalogOriginalRoots', 'videoDerivativeCacheEntries', 'linkedOriginalProvisionalRoots',
	'linkedVideoOriginalBindings', 'mediaAssetChunks', 'mediaAssetStaging', 'mediaAssets', 'projects', 'revisions',
	'settings', 'sourceChunks', 'sources', 'videoDerivatives'].sort();

type Backing = ReturnType<typeof createInstrumentedIndexedDB>;
function fixture({ deleteFailure, deleteGate }: { deleteFailure?: unknown; deleteGate?: ReturnType<typeof deferred<void>> } = {}) {
	const backing = new Map<string, Backing>(), opens: { name: string; version: number | undefined }[] = [], deletes: string[] = [];
	const closed: IDBDatabase[] = [], upgradeModes: string[] = [];
	let onUpgrade: ((opening: IDBOpenDBRequest) => void) | undefined;
	const get = (databaseName: string) => {
		let current = backing.get(databaseName); if (!current) { current = createInstrumentedIndexedDB(); backing.set(databaseName, current); }
		return current;
	};
	const factory = {
		open(databaseName: string, version?: number) {
			opens.push({ name: databaseName, version }); const opening = get(databaseName).open(databaseName, version) as unknown as IDBOpenDBRequest;
			let upgrade: IDBOpenDBRequest['onupgradeneeded'] = null, success: IDBOpenDBRequest['onsuccess'] = null;
			Object.defineProperty(opening, 'onupgradeneeded', { configurable: true,
				set(value: IDBOpenDBRequest['onupgradeneeded']) { upgrade = value; }, get() { return (event: IDBVersionChangeEvent) => {
					upgradeModes.push(opening.transaction!.mode); decorateDatabase(opening.result); decorateTransaction(opening.transaction!);
					onUpgrade?.(opening); upgrade?.call(opening, event);
				}; } });
			Object.defineProperty(opening, 'onsuccess', { configurable: true,
				set(value: IDBOpenDBRequest['onsuccess']) { success = value; }, get() { return (event: Event) => {
					decorateDatabase(opening.result); success?.call(opening, event);
				}; } });
			return opening;
		},
		deleteDatabase(databaseName: string) {
			deletes.push(databaseName);
			const removal = { onsuccess: null as IDBOpenDBRequest['onsuccess'], onerror: null as IDBOpenDBRequest['onerror'],
				onblocked: null as IDBOpenDBRequest['onblocked'], error: deleteFailure ?? null };
			queueMicrotask(() => { removal.onblocked?.call(removal as unknown as IDBOpenDBRequest,
				Object.assign(new Event('blocked'), { oldVersion: 2, newVersion: null })); });
			void (deleteGate?.promise ?? Promise.resolve()).then(() => {
				if (deleteFailure === undefined) { backing.delete(databaseName); removal.onsuccess?.call(removal as unknown as IDBOpenDBRequest, new Event('success')); }
				else removal.onerror?.call(removal as unknown as IDBOpenDBRequest, new Event('error'));
			}); return removal;
		},
	} as unknown as IDBFactory;
	const decorated = new WeakSet<object>();
	function decorateDatabase(database: IDBDatabase) {
		if (decorated.has(database)) return; decorated.add(database);
		Object.defineProperty(database.objectStoreNames, 'length', { get: () => [...database.objectStoreNames].length });
		const close = database.close.bind(database), transaction = database.transaction.bind(database);
		database.close = () => { closed.push(database); close(); };
		database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
			const current = transaction(...args); decorateTransaction(current); return current;
		}) as IDBDatabase['transaction'];
	}
	function decorateTransaction(transaction: IDBTransaction) {
		if (decorated.has(transaction)) return; decorated.add(transaction);
		const objectStore = transaction.objectStore.bind(transaction);
		transaction.objectStore = (storeName: string) => {
			const store = objectStore(storeName), indexes = (store as unknown as { data: { indexes: Map<string, unknown> } }).data.indexes;
			Object.defineProperty(store, 'autoIncrement', { configurable: true, value: false });
			Object.defineProperty(store, 'indexNames', { value: Object.assign([...indexes.keys()], { contains: (key: string) => indexes.has(key) }) });
			return store;
		};
	}
	return { factory, get, opens, deletes, closed, upgradeModes, setUpgrade: (callback: typeof onUpgrade) => { onUpgrade = callback; } };
}
async function open(factory: IDBFactory, version?: number, upgrade?: (opening: IDBOpenDBRequest) => void) {
	return await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = factory.open(name(), version); opening.onupgradeneeded = () => { upgrade?.(opening); };
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
	});
}
function holdOpen(factory: IDBFactory) {
	const entered = deferred<void>(), release = deferred<void>(), original = factory.open.bind(factory); let armed = true;
	factory.open = ((...args: Parameters<IDBFactory['open']>) => {
		const opening = original(...args); if (!armed) return opening; armed = false;
		const prior = Object.getOwnPropertyDescriptor(opening, 'onsuccess')!; let success: IDBOpenDBRequest['onsuccess'] = null;
		Object.defineProperty(opening, 'onsuccess', { configurable: true, set(value: IDBOpenDBRequest['onsuccess']) { success = value; },
			get() { return (event: Event) => {
				opening.onblocked?.call(opening, Object.assign(new Event('blocked'), { oldVersion: 0, newVersion: 2 })); entered.resolve();
				void release.promise.then(() => { prior.set!.call(opening, success); (prior.get!.call(opening) as (event: Event) => void)(event); });
			}; } }); return opening;
	}) as IDBFactory['open'];
	return { entered: entered.promise, release: () => { release.resolve(); }, restore: () => { factory.open = original; } };
}

test('fresh schema and exact media marker commit in the same versionchange transaction', async () => {
	const f = fixture(), raw = allocation();
	const owner = await createPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: raw });
	try {
		assert.equal(owner.databaseName, name()); assert.deepEqual(Object.keys(owner).sort(), ['close', 'databaseName', 'rollback']);
		assert.deepEqual(f.get(name()).records(name(), 'settings'), [{ key: PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1,
			value: photoLibraryRestoreOwnerMarkerV1(raw, 'media') }]);
		assert.deepEqual(f.upgradeModes, ['versionchange']); const database = await open(f.factory);
		assert.equal(database.version, 2); assert.deepEqual([...database.objectStoreNames].sort(), STORES);
		assert.equal(database.transaction('mediaAssets').objectStore('mediaAssets').index('sha256').keyPath, 'sha256');
		database.close(); assert.equal(await inspectPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: raw }), 'owned');
		assert.equal(f.get(name()).stats.getAllRequests.length, 0); assert.equal(f.get(name()).stats.cursorRequests.length, 0);
	} finally { await owner.rollback(); }
	assert.deepEqual(f.deletes, [name()]); assert.equal(await inspectPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: raw }), 'absent');
});

test('inspection aborts absent creation, makes no schema or row writes and omits a version', async () => {
	const f = fixture(); assert.equal(await inspectPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation() }), 'absent');
	assert.deepEqual(f.opens, [{ name: name(), version: undefined }]); assert.deepEqual(f.deletes, []);
	const current = await open(f.factory); assert.equal(current.version, 1); assert.deepEqual([...current.objectStoreNames], []); current.close();
});

for (const version of [1, 2, 3]) test(`preexisting DB${version} is never migrated, adopted or deleted`, async () => {
	const f = fixture(), current = await open(f.factory, version, opening => {
		opening.result.createObjectStore('untouched', { keyPath: 'id' }).add({ id: 'prior', text: 'e\u0301\ud800' });
	});
	const before = f.get(name()).records(name(), 'untouched');
	await assert.rejects(createPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation() }));
	assert.equal(await inspectPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation() }), 'foreign');
	assert.equal(current.version, version); assert.deepEqual([...current.objectStoreNames], ['untouched']);
	assert.deepEqual(f.get(name()).records(name(), 'untouched'), before); assert.deepEqual(f.deletes, []); current.close();
});

test('marker add failure rolls back all schema and baseline staging rows', async () => {
	const f = fixture(); f.setUpgrade(opening => {
		const objectStore = opening.transaction!.objectStore.bind(opening.transaction!);
		opening.transaction!.objectStore = storeName => {
			const store = objectStore(storeName);
			if (storeName === 'settings') f.get(name()).seedRecord(name(), 'settings', { key: PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1, value: 'collision' });
			return store;
		};
	});
	await assert.rejects(createPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation() }), { name: 'ConstraintError' });
	assert.equal(f.get(name()).stats.activeTransactions, 0); assert.deepEqual(f.deletes, []); f.setUpgrade(undefined);
	assert.equal(await inspectPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation() }), 'absent');
});

for (const change of ['ownerToken', 'component', 'databaseName', 'wrapper', 'schema'] as const) test(`inspection refuses foreign ${change} without deletion`, async () => {
	const f = fixture(), owner = await createPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation() }); await owner.close();
	const marker = photoLibraryRestoreOwnerMarkerV1(allocation(), 'media');
	if (change === 'schema') {
		const current = await open(f.factory); const transaction = current.transaction.bind(current);
		current.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
			const tx = transaction(...args), objectStore = tx.objectStore.bind(tx);
			tx.objectStore = key => { const store = objectStore(key); if (key === 'settings') Object.defineProperty(store, 'autoIncrement', { value: true }); return store; };
			return tx;
		}) as IDBDatabase['transaction'];
	} else f.get(name()).seedRecord(name(), 'settings', { key: PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1,
		value: change === 'wrapper' ? marker : { ...marker, [change]: 'foreign' }, ...(change === 'wrapper' ? { extra: true } : {}) });
	assert.equal(await inspectPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation() }), 'foreign');
	assert.deepEqual(f.deletes, []);
});

for (const closeFirst of [false, true]) test(`rollback holds name through terminal blocked deletion after close=${closeFirst}`, async () => {
	const gate = deferred<void>(), f = fixture({ deleteGate: gate }), options = { indexedDB: f.factory, allocation: allocation() };
	const owner = await createPhotoMediaRestoreNamespaceV1(options); if (closeFirst) await owner.close();
	const removal = owner.rollback(); assert.equal(owner.rollback(), removal);
	try {
		assert.equal(await remainsPending(removal), true); const opens = f.opens.length;
		await assert.rejects(createPhotoMediaRestoreNamespaceV1(options), /already owns/iu); assert.equal(f.opens.length, opens);
	} finally { gate.resolve(); await removal; }
	const next = await createPhotoMediaRestoreNamespaceV1(options); await next.rollback();
});

test('close does not release another owner name claim and old rollback refuses before deletion', async () => {
	const f = fixture(), options = { indexedDB: f.factory, allocation: allocation() }, first = await createPhotoMediaRestoreNamespaceV1(options);
	await first.close(); const gate = holdOpen(f.factory); let failure: unknown;
	const second = createPhotoMediaRestoreNamespaceV1(options).catch((error: unknown) => { failure = error; });
	try {
		await gate.entered; await first.close(); await assert.rejects(first.rollback(), /already owns/iu); assert.deepEqual(f.deletes, []);
		gate.release(); await second; assert.ok(failure instanceof Error);
	} finally { gate.release(); await second; gate.restore(); await first.rollback(); }
});

test('held creation cancellation joins native success and exact owned cleanup without inspecting reason or signal shadows', async () => {
	const f = fixture(), gate = holdOpen(f.factory), stop = new AbortController(); let inspected = 0, failure: unknown;
	const reason = new Proxy({}, { get() { inspected++; throw new Error('reason inspected'); }, getPrototypeOf() { inspected++; throw new Error('reason prototype inspected'); } });
	const options = { indexedDB: f.factory, allocation: allocation(), signal: stop.signal };
	const work = createPhotoMediaRestoreNamespaceV1(options).catch((error: unknown) => { failure = error; });
	try {
		await gate.entered; Object.defineProperty(stop.signal, 'reason', { get() { inspected++; throw new Error('signal reason inspected'); } });
		Object.defineProperty(stop.signal, 'throwIfAborted', { get() { inspected++; throw new Error('signal method inspected'); } });
		stop.abort(reason); assert.equal(await remainsPending(work), true);
		const opens = f.opens.length; await assert.rejects(createPhotoMediaRestoreNamespaceV1({ ...options, signal: undefined }), /already owns/iu);
		assert.equal(f.opens.length, opens); assert.deepEqual(f.deletes, []); gate.release(); await work;
		assert.equal(failure, reason); assert.equal(inspected, 0); assert.deepEqual(f.deletes, [name()]);
	} finally { gate.release(); await work; gate.restore(); }
});

test('opaque cancelled creation and failed deletion preserve both exact failures', async () => {
	const cleanup = new DOMException('delete denied', 'UnknownError'), f = fixture({ deleteFailure: cleanup }), gate = holdOpen(f.factory), stop = new AbortController();
	let inspected = 0, failure: unknown; const reason = new Proxy({}, { getPrototypeOf() { inspected++; throw new Error('opaque'); }, get() { inspected++; throw new Error('opaque'); } });
	const work = createPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation(), signal: stop.signal }).catch((error: unknown) => { failure = error; });
	try {
		await gate.entered; stop.abort(reason); gate.release(); await work;
		assert.ok(failure instanceof AggregateError); assert.deepEqual((failure.errors as unknown[]).map((error, index) => error === [reason, cleanup][index]), [true, true]);
		assert.equal(failure.name, 'AbortError'); assert.equal(inspected, 0);
	} finally { gate.release(); await work; gate.restore(); }
});

test('closed admissions and already aborted opaque signals refuse before opening', async () => {
	const f = fixture(), base = { indexedDB: f.factory, allocation: allocation() }; let getters = 0;
	for (const value of [{ ...base, extra: true }, { ...base, get allocation() { getters++; throw new Error('getter'); } },
		{ ...base, allocation: { ...allocation(), ownerToken: 'a'.repeat(32) } }, { ...base, signal: {} }]) {
		await assert.rejects(createPhotoMediaRestoreNamespaceV1(value as unknown as Parameters<typeof createPhotoMediaRestoreNamespaceV1>[0]));
	}
	const stop = new AbortController(), reason = Object.freeze({ opaque: true }); stop.abort(reason);
	Object.defineProperty(stop.signal, 'throwIfAborted', { get() { getters++; throw new Error('shadow'); } });
	await assert.rejects(createPhotoMediaRestoreNamespaceV1({ ...base, signal: stop.signal }), (error: unknown) => error === reason);
	assert.equal(getters, 0); assert.deepEqual(f.opens, []); assert.deepEqual(f.deletes, []);
});

test('ordinary shared opener still creates and migrates exactly its original schema and baseline state', async () => {
	const f = fixture(), current = await openDatabase(f.factory, name());
	assert.deepEqual([...current.objectStoreNames].sort(), STORES);
	assert.deepEqual(f.get(name()).records(name(), 'mediaAssetStaging'), [{ key: 'state', kind: 'state', generation: 'initial' }]);
	assert.deepEqual(f.get(name()).records(name(), 'settings'), []); current.close();
	const old = fixture(), legacy = await open(old.factory, 1, opening => {
		opening.result.createObjectStore('mediaAssets', { keyPath: 'sourceId' }).add({ sourceId: 'keep', name: 'Original' });
	}); legacy.close(); const migrated = await openDatabase(old.factory, name());
	assert.equal(migrated.version, 2); assert.deepEqual(old.get(name()).records(name(), 'mediaAssets'), [{ sourceId: 'keep', name: 'Original' }]);
	assert.equal(migrated.objectStoreNames.contains('catalogOriginalRoots'), true); migrated.close();
});


test('allocation and both factory callbacks are captured before the held native open settles', async () => {
	const f = fixture(), gate = holdOpen(f.factory), raw = allocation(), expected = name();
	const work = createPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: raw });
	try {
		await gate.entered; raw.catalogId = 'changed'; raw.ownerToken = 'c'.repeat(32);
		gate.release(); const owner = await work; await owner.close();
		f.factory.open = () => { throw new Error('Replacement opener invoked.'); };
		f.factory.deleteDatabase = () => { throw new Error('Replacement deleter invoked.'); };
		await owner.rollback(); assert.deepEqual(f.deletes, [expected]);
	} finally { gate.release(); await work; }
});

test('live and close-first marker drift refuse deletion even with prior fresh proof', async () => {
	for (const closed of [false, true]) {
		const f = fixture(), owner = await createPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation() });
		if (closed) await owner.close();
		f.get(name()).seedRecord(name(), 'settings', { key: PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1,
			value: { ...photoLibraryRestoreOwnerMarkerV1(allocation(), 'media'), ownerToken: 'c'.repeat(32) } });
		await assert.rejects(owner.rollback(), /ownership changed/iu); assert.deepEqual(f.deletes, []);
		assert.equal(f.get(name()).records(name(), 'settings')[0].value.ownerToken, 'c'.repeat(32));
	}
});

test('inspection cancellation during marker delivery preserves an opaque reason and joins rollback', async () => {
	const f = fixture(), owner = await createPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation() }); await owner.close();
	const stop = new AbortController(); let inspected = 0;
	const reason = new Proxy({}, { get() { inspected++; throw new Error('opaque'); }, getPrototypeOf() { inspected++; throw new Error('opaque'); } });
	f.get(name()).onNextGetForStore('settings', () => { stop.abort(reason); });
	let failure: unknown;
	await inspectPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation(), signal: stop.signal }).catch((error: unknown) => { failure = error; });
	assert.equal(failure, reason); assert.equal(inspected, 0); assert.equal(f.get(name()).stats.activeTransactions, 0); assert.deepEqual(f.deletes, []);
	assert.equal(await inspectPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation() }), 'owned');
	await owner.rollback();
});

test('inspection cancellation after native open completion still joins its held callback before rejecting', async () => {
	const f = fixture(), owner = await createPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation() }); await owner.close();
	const gate = holdOpen(f.factory), stop = new AbortController(), reason = Object.freeze({ cancel: 'read' });
	const work = inspectPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation(), signal: stop.signal });
	const result = work.catch((error: unknown) => error);
	try {
		await gate.entered; stop.abort(reason); assert.equal(await remainsPending(result), true); gate.release();
		assert.equal(await result, reason); assert.deepEqual(f.deletes, []);
	} finally { gate.release(); await result; gate.restore(); await owner.rollback(); }
});

for (const reason of [null, 17, 'cancelled']) test(`upgrade cancellation retains ${String(reason)} without committing schema or deleting`, async () => {
	const f = fixture(), stop = new AbortController(); let created = 0;
	f.setUpgrade(opening => {
		const create = opening.result.createObjectStore.bind(opening.result);
		opening.result.createObjectStore = ((...args: Parameters<IDBDatabase['createObjectStore']>) => { created++; return create(...args); }) as IDBDatabase['createObjectStore'];
		stop.abort(reason);
	});
	await assert.rejects(createPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation(), signal: stop.signal }), (error: unknown) => error === reason);
	assert.equal(created, 0); assert.deepEqual(f.deletes, []); assert.equal(f.get(name()).stats.activeTransactions, 0);
	f.setUpgrade(undefined); assert.equal(await inspectPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation() }), 'absent');
});

test('an allocation reflection abort is rechecked before any native acquisition', async () => {
	const f = fixture(), stop = new AbortController(), reason = Object.freeze({ admission: 'cancel' });
	const raw = new Proxy(allocation(), { getPrototypeOf(target) { stop.abort(reason); return Reflect.getPrototypeOf(target); } });
	await assert.rejects(createPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: raw, signal: stop.signal }), (error: unknown) => error === reason);
	assert.deepEqual(f.opens, []); assert.deepEqual(f.deletes, []);
});

test('native open security failures remain errors rather than absence or foreign ownership', async () => {
	const failure = new DOMException('denied', 'SecurityError'); let deletes = 0;
	const factory = { open() { throw failure; }, deleteDatabase() { deletes++; throw new Error('unused'); } } as unknown as IDBFactory;
	for (const operation of [createPhotoMediaRestoreNamespaceV1, inspectPhotoMediaRestoreNamespaceV1]) {
		await assert.rejects(operation({ indexedDB: factory, allocation: allocation() }), (error: unknown) => error === failure);
	}
	assert.equal(deletes, 0);
});

test('inspection joins held marker success before closing the borrowed handle', async () => {
	const f = fixture(), owner = await createPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation() }); await owner.close();
	const database = await open(f.factory), transaction = database.transaction.bind(database), close = database.close.bind(database);
	const entered = deferred<void>(), release = deferred<void>(), stop = new AbortController(), reason = Object.freeze({ held: 'marker' });
	let closes = 0, failure: unknown; database.close = () => { closes++; close(); };
	database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
		const current = transaction(...args), objectStore = current.objectStore.bind(current);
		current.objectStore = key => {
			const store = objectStore(key); if (key !== 'settings') return store; const get = store.get.bind(store);
			store.get = ((query: IDBValidKey | IDBKeyRange) => {
				const reading = get(query); let success: IDBRequest['onsuccess'] = null;
				Object.defineProperty(reading, 'onsuccess', { configurable: true, set(value: IDBRequest['onsuccess']) { success = value; },
					get() { return (event: Event) => { entered.resolve(); void release.promise.then(() => success?.call(reading, event)); }; } });
				return reading;
			}) as IDBObjectStore['get']; return store;
		}; return current;
	}) as IDBDatabase['transaction'];
	const work = inspectPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation(), signal: stop.signal }).catch((error: unknown) => { failure = error; });
	try {
		await Promise.race([entered.promise, work]); stop.abort(reason); assert.equal(await remainsPending(work), true); assert.equal(closes, 0);
		release.resolve(); await work; assert.equal(failure, reason); assert.equal(closes, 1); assert.deepEqual(f.deletes, []);
		assert.equal(f.get(name()).stats.activeTransactions, 0);
	} finally { release.resolve(); await work; database.transaction = transaction; database.close = close; await owner.rollback(); }
});

test('native completed read cancellation rejects with exact reason while preserving every stored row', async () => {
	const f = fixture(), owner = await createPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation() }); await owner.close();
	const database = await open(f.factory), transaction = database.transaction.bind(database), stop = new AbortController();
	const reason = Object.freeze({ late: 'read-complete' }); let failure: unknown;
	const before = Object.fromEntries(STORES.map(store => [store, f.get(name()).records(name(), store)]));
	database.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
		const current = transaction(...args); let complete: IDBTransaction['oncomplete'] = null;
		Object.defineProperty(current, 'oncomplete', { configurable: true, set(value: IDBTransaction['oncomplete']) { complete = value; },
			get() { return (event: Event) => { stop.abort(reason); complete?.call(current, event); }; } }); return current;
	}) as IDBDatabase['transaction'];
	try {
		await inspectPhotoMediaRestoreNamespaceV1({ indexedDB: f.factory, allocation: allocation(), signal: stop.signal }).catch((error: unknown) => { failure = error; });
		assert.equal(failure, reason); assert.deepEqual(Object.fromEntries(STORES.map(store => [store, f.get(name()).records(name(), store)])), before);
		assert.deepEqual(f.deletes, []); assert.equal(f.get(name()).stats.activeTransactions, 0);
	} finally { database.transaction = transaction; await owner.rollback(); }
});
