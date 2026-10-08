/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { openPhotoCatalogDatabaseV1 } from '../src/lightscaper/catalog/catalog-database.ts';
import { catalogTransaction } from '../src/lightscaper/catalog/catalog-transaction.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { PHOTO_QUERY_INDEXES_V1, projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-index-v1.ts';
import { PHOTO_QUERY_INDEXES_V2, projectPhotoQueryRowV2 } from '../src/lightscaper/catalog/photo-query-index-v2.ts';
import { PHOTO_CATALOG_DATABASE_VERSION, PHOTO_CATALOG_STORES } from '../src/lightscaper/catalog/repository-types.ts';
import { indexState, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { photoSmartCollectionRecordV1, photoSmartCollectionReferenceKeyV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, photoSmartCollectionSummaryRecordV1,
	readPhotoSmartCollectionStorageContextV1, readPhotoSmartCollectionSummaryRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { request } from '../src/common/editor/storage/indexeddb-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

const DATABASE = 'smart-collection-storage';
// Literal historical schema4 inventory, before independent saved collections exist.
const STORES_V4 = ['catalogs', 'catalogStates', 'photos', 'summaries', 'memberships', 'photoQueryRows', 'photoQueryBuildStates',
	'photoStacks', 'photoStackMemberships', 'photoStackStates', 'photoQueryRowsV2', 'photoQueryBuildStatesV2'] as const;
const NEW_STORES = ['photoSmartCollections', 'photoSmartCollectionSummaries', 'photoSmartCollectionStates'] as const;
function root(count = 0) {
	return normalizePhotoCatalogRootV1({ ...queryCatalogRootV1(), collections: Array.from({ length: count }, (_, index) =>
		({ id: `root-${String(index)}`, name: 'Legacy', kind: 'manual' })) });
}
function definition(id = 'saved', catalogId = 'catalog') {
	return { schemaVersion: 1, kind: 'photo-smart-collection', catalogId, id, revision: 0, name: 'Canon',
		query: { schemaVersion: 2, kind: 'photo-catalog-query', filter: { kind: 'folder', id: 'folder' },
			predicate: { kind: 'keyword', id: 'keyword' } } };
}
function state(collectionCount = 0, revision = 0) {
	return { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision, collectionCount };
}
async function fixture(legacyCount = 0) {
	const indexedDB = createInstrumentedIndexedDB(), factory = indexedDB as unknown as IDBFactory;
	const database = await openPhotoCatalogDatabaseV1(factory, DATABASE, () => undefined);
	indexedDB.seedRecord(DATABASE, 'catalogs', root(legacyCount));
	indexedDB.seedRecord(DATABASE, 'catalogStates', indexState(root(legacyCount), 8));
	return { indexedDB, database, factory };
}
function seed(f: Awaited<ReturnType<typeof fixture>>, id = 'saved', sides: 'both' | 'definition' | 'summary' = 'both') {
	if (sides !== 'summary') f.indexedDB.seedRecord(DATABASE, 'photoSmartCollections', photoSmartCollectionRecordV1(definition(id)));
	if (sides !== 'definition') f.indexedDB.seedRecord(DATABASE, 'photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1(definition(id)));
}
function capture(f: Awaited<ReturnType<typeof fixture>>, signal?: AbortSignal) {
	return catalogTransaction(f.database, PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, 'readonly',
		stores => readPhotoSmartCollectionStorageContextV1(stores, 'catalog', signal), signal);
}

test('DB5 creates only the declared saved-definition/summary/state layouts and root reference multiEntry index', async () => {
	const f = await fixture();
	try {
		assert.equal(PHOTO_CATALOG_DATABASE_VERSION, 5);
		assert.equal(f.database.version, 5);
		assert.deepEqual([...f.database.objectStoreNames].sort(), [...STORES_V4, ...NEW_STORES].sort());
		assert.deepEqual(PHOTO_CATALOG_STORES, [...STORES_V4, ...NEW_STORES]);
		await catalogTransaction(f.database, NEW_STORES, 'readonly', async stores => {
			assert.equal(stores.photoSmartCollections.keyPath, 'key');
			assert.equal(stores.photoSmartCollectionSummaries.keyPath, 'key');
			assert.equal(stores.photoSmartCollectionStates.keyPath, 'catalogId');
			for (const name of ['photoSmartCollections', 'photoSmartCollectionSummaries']) assert.equal(stores[name]!.index('catalogId').keyPath, 'catalogId');
			const index = stores.photoSmartCollections.index('referenceKey');
			assert.deepEqual({ keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry },
				{ keyPath: 'referenceKeys', unique: false, multiEntry: true });
			assert.equal(await request(index.getKey(photoSmartCollectionReferenceKeyV1('catalog', 'keyword', 'keyword'))), undefined);
		});
	} finally { f.database.close(); }
});

test('genuine DB4 to5 upgrade preserves all twelve old stores/bytes and performs zero record operations', async () => {
	const indexedDB = createInstrumentedIndexedDB(), factory = indexedDB as unknown as IDBFactory;
	const old = await new Promise<IDBDatabase>((resolve, reject) => {
		const opening = factory.open(DATABASE, 4);
		opening.onupgradeneeded = () => {
			for (const name of STORES_V4) {
				const keyPath = name === 'photoStackStates' ? 'catalogId' : ['catalogs', 'catalogStates', 'photoQueryBuildStates', 'photoQueryBuildStatesV2'].includes(name) ? 'id' : 'key';
				const store = opening.result.createObjectStore(name, { keyPath });
				if (['summaries', 'photoStacks', 'photoStackMemberships', 'photoQueryRows', 'photoQueryRowsV2'].includes(name)) store.createIndex('catalogId', 'catalogId');
				if (name === 'memberships' || name === 'photoStackMemberships') store.createIndex('scope', 'scope');
				if (name === 'photoStacks') store.createIndex('memberKey', 'memberKeys', { unique: true, multiEntry: true });
				if (name === 'photoQueryRows' || name === 'photoQueryRowsV2') {
					for (const [sort, fields] of Object.entries(name === 'photoQueryRows' ? PHOTO_QUERY_INDEXES_V1 : PHOTO_QUERY_INDEXES_V2)) store.createIndex(sort, [...fields]);
				}
			}
		};
		opening.onsuccess = () => resolve(opening.result); opening.onerror = () => reject(opening.error);
	});
	const photo = queryPhotoV1(), catalog = { ...queryCatalogRootV1(), photoCount: 1, revision: 1 };
	indexedDB.seedRecord(DATABASE, 'catalogs', catalog); indexedDB.seedRecord(DATABASE, 'catalogStates', indexState(catalog, 4));
	indexedDB.seedRecord(DATABASE, 'photos', { key: `catalog|${photo.id}`, document: photo });
	indexedDB.seedRecord(DATABASE, 'summaries', photoSummary(photo));
	indexedDB.seedRecord(DATABASE, 'memberships', { key: 'catalog|all|photo', scope: 'catalog|all', photoKey: `catalog|${photo.id}` });
	indexedDB.seedRecord(DATABASE, 'photoQueryRows', projectPhotoQueryRowV1(photo)); indexedDB.seedRecord(DATABASE, 'photoQueryRowsV2', projectPhotoQueryRowV2(photo));
	for (const [name, schemaVersion] of [['photoQueryBuildStates', 1], ['photoQueryBuildStatesV2', 2]] as const) {
		indexedDB.seedRecord(DATABASE, name, { id: 'catalog', schemaVersion, ready: true, afterKey: null, indexedCount: 1 });
	}
	indexedDB.seedRecord(DATABASE, 'photoStackStates', { schemaVersion: 1, kind: 'photo-stack-state', catalogId: 'catalog', revision: 17, stackCount: 0 });
	const before = new Map(STORES_V4.map(name => [name, JSON.stringify(indexedDB.records(DATABASE, name))]));
	const transaction = old.transaction(STORES_V4), prototype = Object.getPrototypeOf(transaction.objectStore('catalogs')) as object;
	const methods = ['get', 'getKey', 'getAll', 'count', 'put', 'add', 'delete', 'clear', 'openCursor', 'openKeyCursor'] as const;
	const descriptors = new Map(methods.map(name => [name, Object.getOwnPropertyDescriptor(prototype, name)!]));
	const indexPrototype = Object.getPrototypeOf(transaction.objectStore('summaries').index('catalogId')) as object;
	const indexMethods = ['get', 'getKey', 'getAll', 'count', 'openCursor', 'openKeyCursor'] as const;
	const indexDescriptors = new Map(indexMethods.map(name => [name, Object.getOwnPropertyDescriptor(indexPrototype, name)!]));
	let operations = 0;
	for (const method of methods) Object.defineProperty(prototype, method, { configurable: true, value() { operations += 1; throw new Error('Upgrade traversed records.'); } });
	for (const method of indexMethods) Object.defineProperty(indexPrototype, method, { configurable: true, value() { operations += 1; throw new Error('Upgrade traversed an index.'); } });
	old.close();
	let upgraded: IDBDatabase | undefined;
	try {
		upgraded = await openPhotoCatalogDatabaseV1(factory, DATABASE, () => undefined);
		assert.equal(upgraded.version, 5);
		assert.equal(operations, 0);
		for (const name of STORES_V4) assert.equal(JSON.stringify(indexedDB.records(DATABASE, name)), before.get(name), name);
		for (const name of NEW_STORES) assert.equal(indexedDB.recordCount(DATABASE, name), 0);
		assert.equal(indexedDB.stats.getRequests.length, 0); assert.equal(indexedDB.stats.cursorRequests.length, 0);
		assert.equal(indexedDB.stats.getAllRequests.length, 0); assert.equal(indexedDB.stats.countRequests.length, 0);
	} finally {
		for (const [name, descriptor] of descriptors) Object.defineProperty(prototype, name, descriptor);
		for (const [name, descriptor] of indexDescriptors) Object.defineProperty(indexPrototype, name, descriptor);
		upgraded?.close(); await setImmediate();
	}
});

test('cold legacy absence returns a virtual empty revision without creating durable companion state', async () => {
	const f = await fixture(2);
	try {
		const context = await capture(f);
		assert.deepEqual(context.state, state()); assert.equal(context.root.collections.length, 2);
		assert.equal(context.index.indexRevision, 8); assert.ok(Object.isFrozen(context));
		for (const name of NEW_STORES) assert.equal(f.indexedDB.recordCount(DATABASE, name), 0);
		assert.equal(f.indexedDB.stats.getAllRequests.length, 0); assert.equal(f.indexedDB.stats.countRequests.length, 0);
		assert.equal(f.indexedDB.stats.cursorRequests.length, 0);
	} finally { f.database.close(); }
});

test('first-key context checks are bounded to two probes and never load definition or summary payloads', async () => {
	const f = await fixture(); seed(f); f.indexedDB.seedRecord(DATABASE, 'photoSmartCollectionStates', state(1, 9));
	let probes = 0;
	try {
		const context = await catalogTransaction(f.database, PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, 'readonly', async stores => {
			const bounded: Record<string, IDBObjectStore> = { ...stores };
			for (const name of ['photoSmartCollections', 'photoSmartCollectionSummaries']) {
				const store = stores[name]!;
				bounded[name] = new Proxy(store, { get(target, property) {
					if (property !== 'index') throw new Error('Payload/store traversal forbidden.');
					return (indexName: string) => new Proxy(target.index(indexName), { get(index, operation) {
						if (operation !== 'getKey') throw new Error('Nonpoint index traversal forbidden.');
						return (catalog: string) => { probes += 1; assert.equal(catalog, 'catalog'); return index.getKey(catalog); };
					} });
				} });
			}
			return readPhotoSmartCollectionStorageContextV1(bounded, 'catalog');
		});
		assert.equal(probes, 2); assert.deepEqual(context.state, state(1, 9));
		const reads: readonly { readonly store: string }[] = f.indexedDB.stats.getRequests;
		assert.deepEqual(reads.map(entry => entry.store), ['catalogs', 'catalogStates', 'photoSmartCollectionStates']);
	} finally { f.database.close(); }
});

test('missing/zero state rejects retained definition or summary, and positive state rejects either absent side', async () => {
	for (const sides of ['definition', 'summary', 'both'] as const) {
		for (const persisted of [undefined, state(0, 37)]) {
			const f = await fixture(); seed(f, 'saved', sides);
			if (persisted) f.indexedDB.seedRecord(DATABASE, 'photoSmartCollectionStates', persisted);
			try { await assert.rejects(capture(f), /state|retained/iu); }
			finally { f.database.close(); }
		}
	}
	for (const sides of ['definition', 'summary', 'neither'] as const) {
		const f = await fixture(); f.indexedDB.seedRecord(DATABASE, 'photoSmartCollectionStates', state(1));
		if (sides !== 'neither') seed(f, 'saved', sides);
		try { await assert.rejects(capture(f), /missing|state/iu); }
		finally { f.database.close(); }
	}
});

test('retained empty state preserves its tombstone revision and ignores other catalog scopes', async () => {
	const f = await fixture(); f.indexedDB.seedRecord(DATABASE, 'photoSmartCollectionStates', state(0, 37));
	f.indexedDB.seedRecord(DATABASE, 'photoSmartCollections', photoSmartCollectionRecordV1(definition('saved', 'foreign')));
	f.indexedDB.seedRecord(DATABASE, 'photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1(definition('saved', 'foreign')));
	try { assert.deepEqual((await capture(f)).state, state(0, 37)); }
	finally { f.database.close(); }
});

test('context refuses mismatched catalog/root/index/state and malformed scoped first keys', async () => {
	for (const corruption of ['root', 'index-id', 'index-revision', 'index-count', 'state-id', 'future', 'count', 'key', 'unpaired'] as const) {
		const f = await fixture(); seed(f); f.indexedDB.seedRecord(DATABASE, 'photoSmartCollectionStates', state(1));
		if (corruption === 'root') f.indexedDB.seedRecord(DATABASE, 'catalogs', { ...root(), id: 'foreign' }, 'catalog');
		if (corruption === 'index-id') f.indexedDB.seedRecord(DATABASE, 'catalogStates', { ...indexState(root(), 8), id: 'foreign' }, 'catalog');
		if (corruption === 'index-revision') f.indexedDB.seedRecord(DATABASE, 'catalogStates', { ...indexState(root(), 8), rootRevision: 1 });
		if (corruption === 'index-count') f.indexedDB.seedRecord(DATABASE, 'catalogStates', { ...indexState(root(), 8), photoCount: 1 });
		if (corruption === 'state-id') f.indexedDB.seedRecord(DATABASE, 'photoSmartCollectionStates', { ...state(1), catalogId: 'foreign' }, 'catalog');
		if (corruption === 'future') f.indexedDB.seedRecord(DATABASE, 'photoSmartCollectionStates', { ...state(1), schemaVersion: 2 });
		if (corruption === 'count') f.indexedDB.seedRecord(DATABASE, 'photoSmartCollectionStates', state(10_001));
		if (corruption === 'key') {
			await catalogTransaction(f.database, ['photoSmartCollections'], 'readwrite', async stores => {
				await request(stores.photoSmartCollections.delete(photoSmartCollectionRecordV1(definition()).key));
			});
			f.indexedDB.seedRecord(DATABASE, 'photoSmartCollections', { ...photoSmartCollectionRecordV1(definition()), key: '["foreign","saved"]' });
		}
		if (corruption === 'unpaired') seed(f, 'another', 'summary');
		try { await assert.rejects(capture(f)); }
		finally { f.database.close(); }
	}
});

test('combined root1 and companion collection limit admits10000 and refuses10001 with no scans', async () => {
	for (const legacyCount of [0, 9_999, 10_000]) {
		const f = await fixture(legacyCount);
		try {
			f.indexedDB.seedRecord(DATABASE, 'photoSmartCollectionStates', state(0, 14));
			assert.equal((await capture(f)).root.collections.length, legacyCount);
			seed(f); f.indexedDB.seedRecord(DATABASE, 'photoSmartCollectionStates', state(1, 15));
			if (legacyCount === 10_000) await assert.rejects(capture(f), /10000|combined|budget/iu);
			else assert.equal((await capture(f)).state.collectionCount, 1);
			assert.equal(f.indexedDB.stats.countRequests.length, 0); assert.equal(f.indexedDB.stats.getAllRequests.length, 0);
		} finally { f.database.close(); }
	}
});

test('scalar summary row authenticates closed physical identity and retains maximum escaped names within4096', () => {
	const input = { ...definition(), catalogId: 'c'.repeat(128), id: 'i'.repeat(128), name: '\ud800'.repeat(256), revision: Number.MAX_SAFE_INTEGER };
	const row = photoSmartCollectionSummaryRecordV1(input);
	assert.ok(new TextEncoder().encode(JSON.stringify(row)).byteLength <= 4096);
	assert.equal(readPhotoSmartCollectionSummaryRecordV1(row, input.catalogId, row.key).name, input.name);
	assert.throws(() => readPhotoSmartCollectionSummaryRecordV1(row, input.catalogId, '["c","other"]'));
	assert.throws(() => readPhotoSmartCollectionSummaryRecordV1(row, 'foreign', row.key));
	for (const candidate of [{ ...row, key: 'bad' }, { ...row, catalogId: 'foreign' }, { ...row, extra: 1 },
		{ ...row, document: { ...row.document, id: 'other' } }, { ...row, document: { ...row.document, query: {} } }]) {
		assert.throws(() => readPhotoSmartCollectionSummaryRecordV1(candidate, input.catalogId, row.key));
	}
});

test('shape-valid oversized root refuses its2MiB budget before any collection index probe', async () => {
	const f = await fixture();
	const oversized = normalizePhotoCatalogRootV1({ ...root(), keywords: Array.from({ length: 10_000 }, (_, index) =>
		({ id: `keyword-${String(index)}`, name: 'x'.repeat(256), parentId: null })) });
	assert.ok(new TextEncoder().encode(JSON.stringify(oversized)).byteLength > 2_097_152);
	f.indexedDB.seedRecord(DATABASE, 'catalogs', oversized);
	let probes = 0;
	try {
		await assert.rejects(catalogTransaction(f.database, PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, 'readonly', stores => {
			const bounded = { ...stores };
			for (const name of ['photoSmartCollections', 'photoSmartCollectionSummaries']) {
				bounded[name] = new Proxy(stores[name]!, { get() { probes += 1; throw new Error('Probe before root admission.'); } });
			}
			return readPhotoSmartCollectionStorageContextV1(bounded, 'catalog');
		}), /byte budget/iu);
		assert.equal(probes, 0);
	} finally { f.database.close(); }
});

test('invalid identity is rejected before ports and cancellation retains exact opaque reason', async () => {
	let portReads = 0;
	const ports = new Proxy({}, { get() { portReads += 1; throw new Error('resource acquired'); } });
	await assert.rejects(readPhotoSmartCollectionStorageContextV1(ports, 'bad|catalog'));
	assert.equal(portReads, 0);
	const f = await fixture(), stop = new AbortController(), reason = new Proxy({}, { get() { throw new Error('opaque reason inspected'); } });
	f.indexedDB.onNextGetForStore('photoSmartCollectionStates', () => stop.abort(reason));
	try {
		let rejection: unknown;
		try { await capture(f, stop.signal); } catch (error) { rejection = error; }
		assert.equal(rejection, reason); assert.equal(f.indexedDB.stats.activeTransactions, 0);
	}
	finally { f.database.close(); }
});

test('future database6 refuses without mutation and blocked late-success closes the abandoned connection', async () => {
	const indexedDB = createInstrumentedIndexedDB(), base = indexedDB as unknown as IDBFactory;
	await new Promise<void>((resolve, reject) => {
		const opening = base.open('future', 6); opening.onupgradeneeded = () => opening.result.createObjectStore('future', { keyPath: 'id' });
		opening.onsuccess = () => { opening.result.close(); resolve(); }; opening.onerror = () => reject(opening.error);
	});
	await assert.rejects(openPhotoCatalogDatabaseV1(base, 'future', () => undefined), { name: 'VersionError' });
	let closes = 0;
	const factory = { open(name: string, version: number) {
		const opening = base.open(name, version);
		queueMicrotask(() => {
			const close = opening.result.close.bind(opening.result);
			opening.result.close = () => { closes += 1; close(); };
			if (opening.onblocked) Reflect.apply(opening.onblocked, opening, [{ type: 'blocked', target: opening }]);
		});
		return opening;
	} };
	await assert.rejects(openPhotoCatalogDatabaseV1(factory as unknown as IDBFactory, 'blocked', () => undefined), { code: 'STORE_BLOCKED' });
	await setImmediate(); assert.equal(closes, 1); assert.equal(indexedDB.stats.activeTransactions, 0);
});
