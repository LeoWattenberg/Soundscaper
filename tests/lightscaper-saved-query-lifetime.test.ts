/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { PHOTO_CATALOG_STORES, PhotoCatalogClosedError } from '../src/lightscaper/catalog/repository-types.ts';
import { readPhotoSmartCollectionQueryPageV1, readPhotoSmartCollectionStackQueryPageV1 } from '../src/lightscaper/catalog/photo-smart-collection-query-v1.ts';
import { PHOTO_SAVED_QUERY_LIMITS_V1, admitPhotoSavedQueryPageRequestV1 } from '../src/lightscaper/catalog/photo-smart-collection-query-types-v1.ts';
import { photoSmartCollectionRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { photoSmartCollectionSummaryRecordV1 } from '../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { auditMaximumRootV1 } from './helpers/lightscaper-smart-collection-audit-fixture.ts';
import { queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { SMART_COLLECTION_TEST_DATABASE as DB, smartCollectionDefinitionV1 as definition,
	smartCollectionRepositoryFixtureV1 as fixture } from './helpers/lightscaper-smart-collection-repository-fixture.ts';

const criteria = { schemaVersion: 2, kind: 'photo-catalog-query', text: '', sort: { field: 'photo-id', direction: 'ascending' } };
async function setup() {
	const f = await fixture(); await f.repository.publishPhotos('catalog', 0, [queryPhotoV1(), queryPhotoV1(1)]);
	await f.repository.saveSmartCollection({ ...definition(), query: criteria }, null, await f.writeOptions()); return f;
}

test('closed saved requests refuse hostile inputs and cancellation before lazy database acquisition', async () => {
	let opens = 0, getters = 0;
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: { open() { opens++; throw new Error('No database acquisition allowed'); } } as unknown as IDBFactory,
		verifyOriginal: async () => undefined });
	try {
		for (const input of [Object.defineProperty({}, 'continuation', { enumerable: true, get() { getters++; return null; } }),
			{ query: criteria }, { continuation: undefined }, { future: true }, { signal: {} }, Object.assign({}, { [Symbol('hidden')]: true })]) {
			await assert.rejects(repository.readSmartCollectionQueryPageV1('catalog', 'saved', input));
		}
		for (const reason of [17, 'opaque', null]) {
			let caught = false;
			await repository.readSmartCollectionQueryPageV1('catalog', 'saved', { signal: AbortSignal.abort(reason) }).then(() => assert.fail('Expected cancellation'), error => {
				caught = true; assert.ok(error === reason);
			}); assert.equal(caught, true);
		}
		assert.equal(opens, 0); assert.equal(getters, 0);
	} finally { await repository.close(); }
});

test('both saved modes join late native cancellation without inspecting opaque reasons or signal shadows', async () => {
	for (const read of [readPhotoSmartCollectionQueryPageV1, readPhotoSmartCollectionStackQueryPageV1]) {
		for (const value of [17, 'opaque', null, 'proxy']) {
			const f = await setup(), stop = new AbortController(); let probes = 0, signalReads = 0;
			const reason: unknown = value === 'proxy' ? new Proxy({}, { getPrototypeOf() { probes++; throw new Error('Opaque'); }, get() { probes++; throw new Error('Opaque'); } }) : value;
			f.indexedDB.onNextGetForStore('photoSmartCollections', () => {
				Object.defineProperty(stop.signal, 'throwIfAborted', { get() { signalReads++; return () => undefined; } });
				Object.defineProperty(stop.signal, 'aborted', { get() { signalReads++; return false; } }); stop.abort(reason);
			});
			try { let caught = false;
				await read(f.database, 'catalog', 'saved', { signal: stop.signal }).then(() => assert.fail('Expected cancellation'), error => { caught = true; assert.ok(error === reason); });
				assert.equal(caught, true); assert.equal(probes, 0); assert.equal(signalReads, 0); assert.equal(f.indexedDB.stats.activeTransactions, 0);
			} finally { f.database.close(); await f.repository.close(); }
		}
	}
});

test('saved request detaches during held lazy open and close joins acquisition without publishing into the retired repository', async () => {
	const f = await setup(), nativeOpen = f.indexedDB.open.bind(f.indexedDB);
	let release: (() => void) | undefined, requested = false;
	const factory = { open(name: string, version?: number) {
		requested = true; const native = nativeOpen(name, version), request = native as unknown as IDBOpenDBRequest;
		let success: IDBOpenDBRequest['onsuccess'] = null;
		request.onsuccess = event => { release = () => success?.call(request, event as unknown as Event); };
		return new Proxy(request, { set(target, key, value: unknown) {
			if (key === 'onsuccess') { success = value as IDBOpenDBRequest['onsuccess']; return true; }
			return Reflect.set(target, key, value);
		} });
	} } as unknown as IDBFactory;

	const repository = new PhotoCatalogRepositoryV1({ indexedDB: factory, databaseName: DB, verifyOriginal: async () => undefined });
	try {
		const stop = new AbortController(), options: { continuation: unknown; signal: AbortSignal } = { continuation: null, signal: stop.signal };
		const pending = repository.readSmartCollectionQueryPageV1('catalog', 'saved', options);
		options.continuation = { future: true };
		await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(requested, true);
		assert.ok(release); let closed = false; const closing = repository.close().then(() => { closed = true; });
		await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(closed, false);
		stop.abort(17); release();
		await pending.then(() => assert.fail('Expected cancellation'), error => { assert.ok(error instanceof PhotoCatalogClosedError); });
		await closing; assert.equal(closed, true);
	} finally { await repository.close(); f.database.close(); await f.repository.close(); }
});

test('one union readonly transaction owns root, selected definition, summary, build and every Row2 delivery', async () => {
	const f = await setup(), native = f.database.transaction.bind(f.database), transactions: { mode: IDBTransactionMode; stores: string[] }[] = [];
	f.database.transaction = ((stores: string | string[], mode?: IDBTransactionMode) => { transactions.push({ mode: mode ?? 'readonly', stores: typeof stores === 'string' ? [stores] : [...stores] }); return native(stores, mode); }) as IDBDatabase['transaction'];
	try {
		const before = PHOTO_CATALOG_STORES.map(store => f.indexedDB.records(DB, store));
		const page = await readPhotoSmartCollectionQueryPageV1(f.database, 'catalog', 'saved'); assert.equal(page.items.length, 2);
		assert.equal(transactions.length, 1); assert.equal(transactions[0]?.mode, 'readonly');
		assert.deepEqual(new Set(transactions[0]?.stores), new Set(['catalogs', 'catalogStates', 'photoSmartCollections', 'photoSmartCollectionSummaries', 'photoSmartCollectionStates', 'photoQueryRowsV2', 'photoQueryBuildStatesV2']));
		assert.deepEqual(PHOTO_CATALOG_STORES.map(store => f.indexedDB.records(DB, store)), before);
	} finally { f.database.transaction = native; f.database.close(); await f.repository.close(); }
});

test('maximum legal root and escaped full saved recipe admit intact with explicit compiler-copy accounting', async () => {
	const f = await fixture(auditMaximumRootV1()), sample = '\ud800';
	const large = { ...definition(), name: sample.repeat(256), query: { ...criteria, text: sample.repeat(256), predicate: { kind: 'all',
		terms: Array.from({ length: 255 }, () => ({ kind: 'text', column: 'camera-model', operator: 'starts-with', value: sample.repeat(256) })) } } };
	try {
		const row = photoSmartCollectionRecordV1(large), summary = photoSmartCollectionSummaryRecordV1(large);
		const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
		assert.ok(bytes(row.document) > 400000); assert.ok(bytes(row) <= PHOTO_SAVED_QUERY_LIMITS_V1.maximumPrivateRecordBytes);
		assert.ok(bytes({ schemaVersion: 2, kind: 'photo-smart-query', predicate: row.document.query.predicate }) <= PHOTO_SAVED_QUERY_LIMITS_V1.maximumCompiledPredicateBytes);
		f.indexedDB.seedRecord(DB, 'photoSmartCollections', row); f.indexedDB.seedRecord(DB, 'photoSmartCollectionSummaries', summary);
		f.indexedDB.seedRecord(DB, 'photoSmartCollectionStates', { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision: 1, collectionCount: 1 });
		const before = PHOTO_CATALOG_STORES.map(store => f.indexedDB.records(DB, store));
		const page = await readPhotoSmartCollectionQueryPageV1(f.database, 'catalog', 'saved'); assert.equal(page.totalCount, 0); assert.deepEqual(page.items, []);
		assert.equal(page.collectionName, large.name); assert.equal(page.continuation, null);
		assert.deepEqual(PHOTO_CATALOG_STORES.map(store => f.indexedDB.records(DB, store)), before);
		assert.throws(() => admitPhotoSavedQueryPageRequestV1('catalog', 'saved', 'ordinary', { continuation: { future: true } }));
	} finally { f.database.close(); await f.repository.close(); }
});
