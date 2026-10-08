/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { openPhotoCatalogDatabaseV1 } from '../src/lightscaper/catalog/catalog-database.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { readPhotoStackQueryPageV1 } from '../src/lightscaper/catalog/photo-stack-query-pages-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
const query = { text: '', filter: null, sort: { field: 'file-name', direction: 'ascending' } } as const;

async function fixture() {
	const indexedDB = createInstrumentedIndexedDB(), databaseName = crypto.randomUUID();
	const factory = indexedDB as unknown as IDBFactory;
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: factory, databaseName, verifyOriginal: async () => undefined });
	const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Corruption witness', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
	await repository.createCatalog(root);
	await repository.publishPhotos(root.id, 0, [photoArchiveFixture(1).photo, photoArchiveFixture(2).photo]);
	await repository.rebuildQueryIndexPage(root.id);
	await repository.saveStack({ schemaVersion: 1, kind: 'photo-stack', catalogId: root.id, id: 'stack', revision: 0,
		photoIds: ['photo-1', 'photo-2'], coverPhotoId: 'photo-1' }, null, { expectedCatalogRevision: 1, expectedStateRevision: 0 });
	const database = await openPhotoCatalogDatabaseV1(factory, databaseName, () => undefined);
	return { indexedDB, databaseName, repository, database, catalogId: root.id,
		close: async () => { database.close(); await repository.close(); } };
}

async function deleteReverseRows(database: IDBDatabase, photoIds: readonly string[]): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const transaction = database.transaction('photoStackMemberships', 'readwrite');
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(transaction.error ?? new Error('Raw corruption transaction aborted.'));
		for (const photoId of photoIds) transaction.objectStore('photoStackMemberships').delete(`catalog-1|${photoId}`);
	});
}

for (const deleted of [['photo-2'], ['photo-1', 'photo-2']]) {
	test(`collapsed query refuses independently deleted reverse rows: ${deleted.join(', ')}`, async () => {
		const f = await fixture();
		try {
			const valid = await readPhotoStackQueryPageV1(f.database, f.catalogId, { query });
			assert.deepEqual(valid.items.map(row => row.photoId), ['photo-1']);
			await deleteReverseRows(f.database, deleted);
			assert.equal((await f.repository.readStackState(f.catalogId)).stackCount, 1);
			assert.equal(f.indexedDB.recordCount(f.databaseName, 'photoStacks'), 1);
			await assert.rejects(readPhotoStackQueryPageV1(f.database, f.catalogId, { query }), /membership|reverse|forward/iu);
		} finally { await f.close(); }
	});
}

test('collapsed query refuses positive grouping state after both directions of the stack are deleted', async () => {
	const f = await fixture();
	try {
		await new Promise<void>((resolve, reject) => {
			const transaction = f.database.transaction(['photoStacks', 'photoStackMemberships'], 'readwrite');
			transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error);
			transaction.objectStore('photoStacks').delete('catalog-1|stack');
			for (const photoId of ['photo-1', 'photo-2']) transaction.objectStore('photoStackMemberships').delete(`catalog-1|${photoId}`);
		});
		assert.equal((await f.repository.readStackState(f.catalogId)).stackCount, 1);
		assert.equal(f.indexedDB.recordCount(f.databaseName, 'photoStacks'), 0);
		assert.equal(f.indexedDB.recordCount(f.databaseName, 'photoStackMemberships'), 0);
		await assert.rejects(readPhotoStackQueryPageV1(f.database, f.catalogId, { query }), /state|count|stack/iu);
	} finally { await f.close(); }
});
