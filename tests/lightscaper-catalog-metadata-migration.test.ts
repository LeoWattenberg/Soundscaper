/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { openPhotoCatalogDatabaseV1 } from '../src/lightscaper/catalog/catalog-database.ts';
import { PHOTO_CATALOG_DATABASE_VERSION } from '../src/lightscaper/catalog/repository-types.ts';
import { PHOTO_QUERY_INDEXES_V1, projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-index-v1.ts';
import { indexState, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';

const LEGACY_STORES_V3 = ['catalogs', 'catalogStates', 'photos', 'summaries', 'memberships', 'photoQueryRows',
	'photoQueryBuildStates', 'photoStacks', 'photoStackMemberships', 'photoStackStates'] as const;

test('a new database owns V2 metadata query stores and all four native sort indexes', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const database = await openPhotoCatalogDatabaseV1(indexedDB as unknown as IDBFactory, 'metadata-new', () => undefined);
	try {
		assert.equal(PHOTO_CATALOG_DATABASE_VERSION, 5);
		assert.equal(database.objectStoreNames.contains('photoQueryRowsV2'), true);
		assert.equal(database.objectStoreNames.contains('photoQueryBuildStatesV2'), true);
		const transaction = database.transaction(['photoQueryRowsV2'], 'readonly');
		const rows = transaction.objectStore('photoQueryRowsV2');
		for (const name of ['catalogId', 'photo-id', 'file-name', 'capture-time', 'rating']) assert.doesNotThrow(() => rows.index(name));
	} finally { database.close(); }
});

test('V3 upgrades add V2 stores without scanning or changing original photos and old derived bytes', async () => {
	const indexedDB = createInstrumentedIndexedDB(), factory = indexedDB as unknown as IDBFactory;
	await new Promise<void>((resolve, reject) => {
		const opening = factory.open('metadata-legacy', 3);
		opening.onupgradeneeded = () => {
			for (const name of LEGACY_STORES_V3) {
				const keyPath = name === 'photoStackStates' ? 'catalogId' : name === 'catalogs' || name === 'catalogStates' || name === 'photoQueryBuildStates' ? 'id' : 'key';
				const store = opening.result.createObjectStore(name, { keyPath });
				if (name === 'summaries' || name === 'photoStacks' || name === 'photoStackMemberships') store.createIndex('catalogId', 'catalogId');
				if (name === 'memberships' || name === 'photoStackMemberships') store.createIndex('scope', 'scope');
				if (name === 'photoStacks') store.createIndex('memberKey', 'memberKeys', { unique: true, multiEntry: true });
				if (name === 'photoQueryRows') {
					store.createIndex('catalogId', 'catalogId');
					for (const [sort, fields] of Object.entries(PHOTO_QUERY_INDEXES_V1)) store.createIndex(sort, [...fields]);
				}
			}
		};
		opening.onsuccess = () => { opening.result.close(); resolve(); }; opening.onerror = () => reject(opening.error);
	});
	const photo = queryPhotoV1(), root = { ...queryCatalogRootV1(), revision: 1, photoCount: 1 };
	indexedDB.seedRecord('metadata-legacy', 'catalogs', root);
	indexedDB.seedRecord('metadata-legacy', 'catalogStates', indexState(root, 1));
	indexedDB.seedRecord('metadata-legacy', 'photos', { key: `catalog|${photo.id}`, document: photo });
	indexedDB.seedRecord('metadata-legacy', 'summaries', photoSummary(photo));
	indexedDB.seedRecord('metadata-legacy', 'photoQueryRows', projectPhotoQueryRowV1(photo));
	indexedDB.seedRecord('metadata-legacy', 'photoQueryBuildStates', { id: 'catalog', schemaVersion: 1, ready: true, afterKey: null, indexedCount: 1 });
	const before = new Map(LEGACY_STORES_V3.map(name => [name, JSON.stringify(indexedDB.records('metadata-legacy', name))]));
	const reads = indexedDB.stats.getRequests.length, cursors = indexedDB.stats.cursorRequests.length;
	const database = await openPhotoCatalogDatabaseV1(factory, 'metadata-legacy', () => undefined);
	try {
		assert.equal(database.objectStoreNames.contains('photoQueryRowsV2'), true);
		assert.equal(database.objectStoreNames.contains('photoQueryBuildStatesV2'), true);
		for (const name of LEGACY_STORES_V3) assert.equal(JSON.stringify(indexedDB.records('metadata-legacy', name)), before.get(name), name);
		assert.equal(indexedDB.recordCount('metadata-legacy', 'photoQueryRowsV2'), 0);
		assert.equal(indexedDB.recordCount('metadata-legacy', 'photoQueryBuildStatesV2'), 0);
		assert.equal(indexedDB.stats.getRequests.length, reads);
		assert.equal(indexedDB.stats.cursorRequests.length, cursors);
		assert.equal(indexedDB.stats.getAllRequests.length, 0);
	} finally { database.close(); }
});
