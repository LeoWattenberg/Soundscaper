/* SPDX-License-Identifier: AGPL-3.0-only */

import { openPhotoCatalogDatabaseV1 } from '../../src/lightscaper/catalog/catalog-database.ts';
import { catalogTransaction } from '../../src/lightscaper/catalog/catalog-transaction.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { indexState } from '../../src/lightscaper/catalog/repository-records.ts';
import { PHOTO_CATALOG_STORES } from '../../src/lightscaper/catalog/repository-types.ts';
import { photoSmartCollectionRecordV1 } from '../../src/lightscaper/catalog/photo-smart-collection-record-v1.ts';
import { photoSmartCollectionSummaryRecordV1, PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1,
	readPhotoSmartCollectionStorageContextV1 } from '../../src/lightscaper/catalog/photo-smart-collection-storage-v1.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoCatalogRootV1 } from '../../src/lightscaper/catalog/types.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './instrumented-indexeddb-keys.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
export const AUDIT_DATABASE = 'smart-collection-audit';
export function auditRootV1(): PhotoCatalogRootV1 {
	return normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog', name: 'Audit', revision: 0, photoCount: 0,
		folders: [{ id: 'folder', name: 'Folder', parentId: null }],
		keywords: [{ id: 'keyword', name: 'Keyword', parentId: null }],
		collections: [{ id: 'manual', name: 'Manual', kind: 'manual' }] });
}
export function auditDefinitionV1(index = 0) {
	return { schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog',
		id: `saved-${String(index).padStart(5, '0')}`, name: 'Saved', revision: 0,
		query: { schemaVersion: 2, kind: 'photo-catalog-query', text: '',
			filter: { kind: 'folder', id: 'folder' }, predicate: { kind: 'keyword', id: 'keyword' } } };
}
export function auditMaximumRootV1(): PhotoCatalogRootV1 {
	const initial = auditRootV1(), keywords = [...initial.keywords.map(node => ({ ...node })),
		...Array.from({ length: 6_900 }, (_, index) => ({ id: `z-${String(index)}`, name: '界'.repeat(80), parentId: null }))];
	const value = { ...initial, keywords };
	let remaining = LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes - new TextEncoder().encode(JSON.stringify(value)).byteLength;
	for (const keyword of keywords) {
		const added = Math.min(remaining, 256 - keyword.name.length);
		keyword.name += 'x'.repeat(added); remaining -= added;
		if (remaining === 0) break;
	}
	if (remaining !== 0) throw new Error('Maximum root fixture cannot fill its exact byte budget.');
	return normalizePhotoCatalogRootV1(value);
}
export async function smartCollectionAuditFixtureV1(count = 0, root = auditRootV1(), supportsContinuePrimaryKey = true) {
	const indexedDB = createInstrumentedIndexedDB({ supportsContinuePrimaryKey });
	const factory = indexedDB as unknown as IDBFactory;
	const database = await openPhotoCatalogDatabaseV1(factory, AUDIT_DATABASE, () => undefined);
	indexedDB.seedRecord(AUDIT_DATABASE, 'catalogs', root);
	indexedDB.seedRecord(AUDIT_DATABASE, 'catalogStates', indexState(root, 8));
	if (count) indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollectionStates', auditStateV1(count));
	function seed(value: unknown) {
		indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollections', photoSmartCollectionRecordV1(value));
		indexedDB.seedRecord(AUDIT_DATABASE, 'photoSmartCollectionSummaries', photoSmartCollectionSummaryRecordV1(value));
	}
	for (let index = 0; index < count; index++) seed(auditDefinitionV1(index));
	return { indexedDB, factory, database, root, seed,
		context: () => catalogTransaction(database, PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, 'readonly',
			stores => readPhotoSmartCollectionStorageContextV1(stores, root.id)),
		snapshot: () => PHOTO_CATALOG_STORES.map(store => [store, JSON.stringify(indexedDB.records(AUDIT_DATABASE, store))] as const),
		close: () => database.close() };
}
export function auditStateV1(collectionCount: number, revision = 7) {
	return { schemaVersion: 1, kind: 'photo-smart-collections-state', catalogId: 'catalog', revision, collectionCount };
}
export type SmartCollectionAuditFixtureV1 = Awaited<ReturnType<typeof smartCollectionAuditFixtureV1>>;
