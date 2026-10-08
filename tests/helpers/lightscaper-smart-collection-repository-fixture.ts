/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { catalogTransaction } from '../../src/lightscaper/catalog/catalog-transaction.ts';
import { openPhotoCatalogDatabaseV1 } from '../../src/lightscaper/catalog/catalog-database.ts';
import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, photoSmartCollectionSummaryRecordV1,
	readPhotoSmartCollectionStorageContextV1 } from '../../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { photoSmartCollectionRecordV1 } from '../../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './instrumented-indexeddb-keys.ts';
import { queryCatalogRootV1 } from './lightscaper-catalog-query-fixture.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
export const SMART_COLLECTION_TEST_DATABASE = 'saved-query-repository';
export function smartCollectionDefinitionV1(id = 'saved') {
	return { schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog', id, revision: 0, name: `Saved ${id}`,
		query: { schemaVersion: 2, kind: 'photo-catalog-query', text: 'Landscape', filter: { kind: 'folder', id: 'folder' },
			sort: { field: 'rating', direction: 'descending' }, predicate: { kind: 'all', terms: [
				{ kind: 'keyword', id: 'keyword' }, { kind: 'text', column: 'camera-make', operator: 'equals', value: 'Canon' },
			] } } };
}
export async function smartCollectionRepositoryFixtureV1(root = queryCatalogRootV1()) {
	const indexedDB = createInstrumentedIndexedDB(), factory = indexedDB as unknown as IDBFactory;
	const options = { indexedDB: factory, databaseName: SMART_COLLECTION_TEST_DATABASE, verifyOriginal: async () => undefined };
	const create = () => new PhotoCatalogRepositoryV1(options), repository = create();
	await repository.createCatalog(root);
	const database = await openPhotoCatalogDatabaseV1(factory, SMART_COLLECTION_TEST_DATABASE, () => undefined);
	const context = () => catalogTransaction(database, PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, 'readonly', stores =>
		readPhotoSmartCollectionStorageContextV1(stores, 'catalog'));
	const writeOptions = async () => {
		const current = await context();
		return { expectedCatalogRevision: current.root.revision, expectedIndexRevision: current.index.indexRevision,
			expectedStateRevision: current.state.revision };
	};
	const seed = (count: number) => {
		for (let index = 0; index < count; index += 1) {
			const value = smartCollectionDefinitionV1(`saved-${String(index).padStart(4, '0')}`);
			indexedDB.seedRecord(SMART_COLLECTION_TEST_DATABASE, 'photoSmartCollections', photoSmartCollectionRecordV1(value));
			indexedDB.seedRecord(SMART_COLLECTION_TEST_DATABASE, 'photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1(value));
		}
		indexedDB.seedRecord(SMART_COLLECTION_TEST_DATABASE, 'photoSmartCollectionStates', { schemaVersion: 1,
			kind: 'photo-smart-collections-state', catalogId: 'catalog', revision: 1, collectionCount: count });
	};
	const mutate = (store: string, operation: (store: IDBObjectStore) => Promise<void>) => catalogTransaction(database,
		[store], 'readwrite', stores => operation(stores[store]!));
	return { indexedDB, database, repository, create, context, writeOptions, seed, mutate, request };
}
