/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPhotoCatalogRestoreStageV1 } from '../src/lightscaper/catalog/photo-catalog-restore-stage-v1.ts';
import { openPhotoCatalogDatabaseV1 } from '../src/lightscaper/catalog/catalog-database.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { savedArchiveRootV3 } from './helpers/lightscaper-saved-collection-archive-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';

const DATABASE = 'restore-lifecycle';
function fixture(deleteFailure?: unknown) {
	const raw = createInstrumentedIndexedDB(), deleted: string[] = []; let opens = 0;
	const factory = { open(name: string, version?: number) { opens++; return raw.open(name, version); },
		deleteDatabase(name: string) {
			deleted.push(name); const removal = { onsuccess: null as IDBOpenDBRequest['onsuccess'], onerror: null as IDBOpenDBRequest['onerror'],
				onblocked: null, error: deleteFailure ?? null };
			queueMicrotask(() => {
				const callback = deleteFailure === undefined ? removal.onsuccess : removal.onerror;
				callback?.call(removal as unknown as IDBOpenDBRequest, new Event(deleteFailure === undefined ? 'success' : 'error'));
			}); return removal;
		} } as unknown as IDBFactory;
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
	Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
	return { raw, factory, deleted, opens: () => opens,
		close() { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); } };
}
async function currentDatabase(factory: IDBFactory): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const opening = factory.open(DATABASE, 5);
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
	});
}
/** Hold the real instrumented transport event; do not replace request operations or their completion. */
function holdOpen(factory: IDBFactory) {
	const entered = deferred<void>(), release = deferred<void>(), open = factory.open.bind(factory);
	let held = false;
	factory.open = ((name: string, version?: number) => {
		const opening = open(name, version);
		if (!held) {
			held = true; let success: IDBOpenDBRequest['onsuccess'] = null;
			Object.defineProperty(opening, 'onsuccess', { configurable: true,
				set(value: IDBOpenDBRequest['onsuccess']) { success = value; }, get() { return (event: Event) => {
					opening.onblocked?.call(opening, Object.assign(new Event('blocked'), { oldVersion: 0, newVersion: version ?? null })); entered.resolve();
					void release.promise.then(() => success?.call(opening, event));
				}; } });
		}
		return opening;
	}) as IDBFactory['open'];
	return { entered: entered.promise, release: () => { release.resolve(); }, restore: () => { factory.open = open; } };
}
function holdCompletion(database: IDBDatabase, match: (stores: readonly string[]) => boolean, onComplete?: () => void) {
	const entered = deferred<void>(), release = deferred<void>(), transaction = database.transaction.bind(database); let armed = true;
	database.transaction = ((names: string | string[], mode?: IDBTransactionMode) => {
		const current = transaction(names, mode), stores = typeof names === 'string' ? [names] : names;
		if (armed && mode === 'readwrite' && match(stores)) {
			armed = false; let complete: IDBTransaction['oncomplete'] = null;
			Object.defineProperty(current, 'oncomplete', { configurable: true,
				set(value: IDBTransaction['oncomplete']) { complete = value; }, get() { return (event: Event) => {
					entered.resolve(); onComplete?.(); void release.promise.then(() => complete?.call(current, event));
				}; } });
		}
		return current;
	}) as IDBDatabase['transaction'];
	return { entered: entered.promise, release: () => { release.resolve(); }, restore: () => { database.transaction = transaction; } };
}

for (const version of [4, 5, 6]) {
	test(`preexisting DB${version} collision preserves all bytes and never deletes the namespace`, async () => {
		const f = fixture(); let original!: IDBDatabase;
		try {
			await new Promise<void>((resolve, reject) => {
				const opening = f.factory.open(DATABASE, version);
				opening.onupgradeneeded = () => { opening.result.createObjectStore('untouched', { keyPath: 'id' }).add({ id: 'prior', text: 'e\u0301\ud800' }); };
				opening.onsuccess = () => { original = opening.result; resolve(); }; opening.onerror = () => { reject(opening.error); };
			});
			const before = f.raw.records(DATABASE, 'untouched');
			await assert.rejects(createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: DATABASE,
				root: savedArchiveRootV3(0), savedState: null }));
			assert.equal(original.version, version); assert.deepEqual([...original.objectStoreNames], ['untouched']);
			assert.deepEqual(f.raw.records(DATABASE, 'untouched'), before); assert.deepEqual(f.deleted, []);
		} finally { original?.close(); f.close(); }
	});
}

test('blocked/open callback cancellation stays joined and refuses another open until terminal cleanup', async () => {
	const f = fixture(), gate = holdOpen(f.factory), stop = new AbortController(), reason = Object.freeze({ cancel: 'exact' });
	const options = { indexedDB: f.factory, databaseName: DATABASE, root: savedArchiveRootV3(0), savedState: null, signal: stop.signal };
	let failure: unknown; const work = createPhotoCatalogRestoreStageV1(options).catch((error: unknown) => { failure = error; });
	try {
		await gate.entered; stop.abort(reason); assert.equal(await remainsPending(work), true);
		const opens = f.opens(); await assert.rejects(createPhotoCatalogRestoreStageV1({ ...options, signal: undefined }), /already owns/iu);
		assert.equal(f.opens(), opens); assert.deepEqual(f.deleted, []);
		gate.release(); await work; assert.equal(failure, reason); assert.deepEqual(f.deleted, [DATABASE]);
	} finally { gate.release(); await work; gate.restore(); f.close(); }
});

test('opaque native abort plus failed fresh cleanup preserves both identities without inspection', async () => {
	const cleanup = new DOMException('Delete refused.', 'UnknownError'), f = fixture(cleanup), gate = holdOpen(f.factory), stop = new AbortController();
	let inspections = 0, failure: unknown;
	const reason = new Proxy({}, { getPrototypeOf() { inspections++; throw new Error('Opaque prototype inspected.'); },
		get() { inspections++; throw new Error('Opaque value inspected.'); } });
	const work = createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: DATABASE,
		root: savedArchiveRootV3(0), savedState: null, signal: stop.signal }).catch((error: unknown) => { failure = error; });
	try {
		await gate.entered; stop.abort(reason); assert.equal(await remainsPending(work), true); gate.release(); await work;
		assert.equal(inspections, 0); assert.ok(failure instanceof AggregateError);
		const errors = failure.errors as unknown[]; assert.equal(errors[0], reason); assert.equal(errors[1], cleanup);
		assert.equal(failure.name, 'AbortError'); assert.deepEqual(f.deleted, [DATABASE]);
	} finally { gate.release(); await work; gate.restore(); f.close(); }
});

test('a native AbortError outside the external reason retains legacy cleanup classification', async () => {
	const primary = new DOMException('Initialization was aborted.', 'AbortError'), cleanup = new Error('Delete failed.');
	const f = fixture(cleanup), gate = holdOpen(f.factory), stop = new AbortController();
	let failure: unknown;
	const work = createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: DATABASE,
		root: savedArchiveRootV3(0), savedState: null, signal: stop.signal }).catch((error: unknown) => { failure = error; });
	try {
		await gate.entered;
		const current = await currentDatabase(f.factory);
		current.transaction = () => { throw primary; };
		gate.release(); await work;
		assert.ok(failure instanceof AggregateError); assert.equal(failure.name, 'AbortError');
		const errors = failure.errors as unknown[]; assert.equal(errors[0], primary); assert.equal(errors[1], cleanup);
		assert.deepEqual(f.deleted, [DATABASE]);
	} finally { gate.release(); await work; gate.restore(); f.close(); }
});

test('null native cancellation during the upgrade event is retained before any schema creation', async () => {
	const f = fixture(), stop = new AbortController(), open = f.factory.open.bind(f.factory);
	let created = 0, failure: unknown;
	f.factory.open = ((name: string, version?: number) => {
		const opening = open(name, version); let upgrade: IDBOpenDBRequest['onupgradeneeded'] = null;
		Object.defineProperty(opening, 'onupgradeneeded', { configurable: true,
			set(value: IDBOpenDBRequest['onupgradeneeded']) { upgrade = value; }, get() { return (event: IDBVersionChangeEvent) => {
				const create = opening.result.createObjectStore.bind(opening.result);
				opening.result.createObjectStore = ((...args: Parameters<IDBDatabase['createObjectStore']>) => {
					created++; return create(...args);
				}) as IDBDatabase['createObjectStore'];
				stop.abort(null); upgrade?.call(opening, event);
			}; } }); return opening;
	}) as IDBFactory['open'];
	try {
		await createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: DATABASE,
			root: savedArchiveRootV3(0), savedState: null, signal: stop.signal }).catch((error: unknown) => { failure = error; });
		assert.equal(failure, null); assert.equal(created, 0);
		assert.equal(f.raw.records(DATABASE, 'catalogs').length, 0); assert.deepEqual(f.deleted, []);
		assert.equal(f.raw.stats.activeTransactions, 0);
	} finally { f.factory.open = open; f.close(); }
});

test('close joins held child completion and prevents another writer while cleanup is pending', async () => {
	const f = fixture(), stage = await createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: DATABASE,
		root: savedArchiveRootV3(1), savedState: null });
	const current = await currentDatabase(f.factory), gate = holdCompletion(current, names => names.includes('photos'));
	let failure: unknown; const write = stage.writePhoto(photoArchiveFixture(1).photo).catch((error: unknown) => { failure = error; });
	try {
		await gate.entered; const close = stage.close(); assert.equal(await remainsPending(close), true);
		assert.equal(await remainsPending(write), true); await assert.rejects(stage.writePhoto(photoArchiveFixture(1).photo), /closed/iu);
		gate.release(); await write; await close; assert.ok(failure instanceof DOMException);
		assert.equal(failure.name, 'AbortError'); assert.equal(f.raw.stats.activeTransactions, 0); assert.deepEqual(f.deleted, []);
	} finally { gate.release(); await write; gate.restore(); await stage.rollback(); f.close(); }
});

test('completed candidate readiness wins over late abort while close still joins its held ACK', async () => {
	const f = fixture(), stop = new AbortController(), reason = Object.freeze({ late: true });
	const stage = await createPhotoCatalogRestoreStageV1({ indexedDB: f.factory, databaseName: DATABASE,
		root: savedArchiveRootV3(0), savedState: null, signal: stop.signal });
	const current = await currentDatabase(f.factory), gate = holdCompletion(current, names => names.length === 15, () => { stop.abort(reason); });
	const finish = stage.finish();
	try {
		await gate.entered; const close = stage.close(); assert.equal(await remainsPending(finish), true); assert.equal(await remainsPending(close), true);
		gate.release(); const result = await finish; await close;
		assert.equal(result.catalogRevision, 23); assert.equal(result.photoCount, 0);
		assert.equal(f.raw.records(DATABASE, 'photoQueryBuildStatesV2')[0].ready, true); assert.deepEqual(f.deleted, []);
	} finally { gate.release(); await finish; gate.restore(); await stage.close(); f.close(); }
});

test('closed descriptors and native abort reasons refuse admission before any database open', async () => {
	const f = fixture(); let inspections = 0;
	try {
		const base = { indexedDB: f.factory, databaseName: DATABASE, root: savedArchiveRootV3(0), savedState: null };
		for (const options of [{ ...base, extra: true }, { ...base, get root() { inspections++; throw new Error('Getter invoked.'); } },
			{ ...base, signal: {} }, { ...base, savedState: undefined }]) {
			await assert.rejects(createPhotoCatalogRestoreStageV1(options as unknown as Parameters<typeof createPhotoCatalogRestoreStageV1>[0]));
		}
		const stop = new AbortController(), reason = new Proxy({}, { get() { inspections++; throw new Error('Reason inspected.'); } });
		stop.abort(reason); Object.defineProperty(stop.signal, 'throwIfAborted', { get() { inspections++; throw new Error('Signal getter.'); } });
		let failure: unknown; await createPhotoCatalogRestoreStageV1({ ...base, signal: stop.signal }).catch((error: unknown) => { failure = error; });
		assert.equal(failure, reason); assert.equal(inspections, 0); assert.equal(f.opens(), 0); assert.deepEqual(f.deleted, []);
	} finally { f.close(); }
});

test('normal opener still migrates an existing schema and preserves rows through the extraction', async () => {
	const f = fixture();
	try {
		const prior = await new Promise<IDBDatabase>((resolve, reject) => {
			const opening = f.factory.open(DATABASE, 4);
			opening.onupgradeneeded = () => { opening.result.createObjectStore('catalogs', { keyPath: 'id' }).add(savedArchiveRootV3(0)); };
			opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
		});
		const before = f.raw.records(DATABASE, 'catalogs'); prior.close();
		const current = await openPhotoCatalogDatabaseV1(f.factory, DATABASE, () => undefined);
		assert.equal(current.version, 5); assert.deepEqual(f.raw.records(DATABASE, 'catalogs'), before);
		assert.equal(current.objectStoreNames.contains('photoSmartCollections'), true); current.close();
	} finally { f.close(); }
});
