/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { request } from '../src/common/editor/storage/indexeddb-backend.ts';
import { openPhotoCatalogDatabaseV1 } from '../src/lightscaper/catalog/catalog-database.ts';
import { catalogTransaction } from '../src/lightscaper/catalog/catalog-transaction.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { indexState } from '../src/lightscaper/catalog/repository-records.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

function fixture(context: TestContext) {
	const indexedDB = createInstrumentedIndexedDB(), databaseName = `photo-snapshot-${crypto.randomUUID()}`;
	const create = () => new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory,
		databaseName, verifyOriginal: async () => undefined });
	const repository = create();
	context.after(async () => { await repository.close(); });
	const root = normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1,
		kind: 'photo-catalog', id: 'catalog-1', name: 'Snapshot library', revision: 0, photoCount: 0,
		folders: [], keywords: [], collections: [] });
	return { indexedDB, databaseName, repository, create, root,
		open: () => openPhotoCatalogDatabaseV1(indexedDB as unknown as IDBFactory, databaseName, () => undefined) };
}

test('snapshot reads the validated root and mutation fence in one bounded readonly transaction', async context => {
	const f = fixture(context); await f.repository.createCatalog(f.root);
	const database = await f.open(), transaction = database.transaction;
	const calls: { stores: readonly string[]; mode: IDBTransactionMode | undefined }[] = [];
	database.transaction = (stores, mode, options) => {
		calls.push({ stores: typeof stores === 'string' ? [stores] : [...stores], mode });
		return transaction.call(database, stores, mode, options);
	};
	try {
		const before = f.indexedDB.stats.getRequests.length;
		const snapshot = await f.repository.readSnapshot(f.root.id);
		assert.deepEqual(snapshot, { catalog: f.root, indexRevision: 0 });
		assert.equal(Object.isFrozen(snapshot), true); assert.equal(Object.isFrozen(snapshot?.catalog), true);
		assert.deepEqual(calls, [{ stores: ['catalogs', 'catalogStates'], mode: 'readonly' }]);
		assert.deepEqual(f.indexedDB.stats.getRequests.slice(before).map((entry: { store: string }) => entry.store).sort(), ['catalogStates', 'catalogs']);
		assert.equal(f.indexedDB.stats.cursorRequests.length, 0); assert.equal(f.indexedDB.stats.getAllRequests.length, 0);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { database.transaction = transaction; database.close(); }
});

test('publication, photo edits and root edits advance the snapshot fence without changing prior captures', async context => {
	const f = fixture(context); await f.repository.createCatalog(f.root);
	const first = await f.repository.readSnapshot(f.root.id); assert.ok(first);
	const photo = photoArchiveFixture().photo;
	const published = await f.repository.publishPhotos(f.root.id, 0, [photo]);
	const imported = await f.repository.readSnapshot(f.root.id); assert.ok(imported);
	assert.equal(imported.catalog.revision, 1); assert.equal(imported.catalog.photoCount, 1); assert.equal(imported.indexRevision, 1);
	await f.repository.savePhoto({ ...photo, rating: 5 }, 0);
	const edited = await f.repository.readSnapshot(f.root.id); assert.ok(edited);
	assert.deepEqual(edited.catalog, imported.catalog); assert.equal(edited.indexRevision, 2);
	await f.repository.saveCatalog({ ...published, name: 'Renamed library' }, published.revision);
	const renamed = await f.repository.readSnapshot(f.root.id); assert.ok(renamed);
	assert.equal(renamed.catalog.revision, 2); assert.equal(renamed.indexRevision, 3);
	assert.deepEqual(first, { catalog: f.root, indexRevision: 0 });
	assert.deepEqual(await f.repository.readSnapshot(f.root.id), renamed);
});

test('snapshot returns null only when both the requested root and index state are absent', async context => {
	const f = fixture(context);
	assert.equal(await f.repository.readSnapshot(f.root.id), null);
	assert.equal(f.indexedDB.stats.activeTransactions, 0);
	await f.repository.createCatalog(f.root);
	assert.equal(await f.repository.readSnapshot('another-catalog'), null);
	const database = await f.open();
	try {
		await catalogTransaction(database, ['catalogs'], 'readwrite', async stores => { await request(stores.catalogs.delete(f.root.id)); });
		await assert.rejects(f.repository.readSnapshot(f.root.id), /root|state|snapshot/iu);
	} finally { database.close(); }
});

test('an existing root without its durable index state refuses instead of becoming an empty snapshot', async context => {
	const f = fixture(context); await f.repository.createCatalog(f.root);
	const database = await f.open();
	try {
		await catalogTransaction(database, ['catalogStates'], 'readwrite', async stores => { await request(stores.catalogStates.delete(f.root.id)); });
		await assert.rejects(f.repository.readSnapshot(f.root.id), /state|snapshot/iu);
		assert.deepEqual(await f.repository.loadCatalog(f.root.id), f.root);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	} finally { database.close(); }
});

for (const [label, changes] of [
	['foreign identity', { id: 'another-catalog' }], ['stale root revision', { rootRevision: 1 }],
	['wrong photo count', { photoCount: 1 }], ['negative fence', { indexRevision: -1 }],
	['future schema', { schemaVersion: 2 }], ['unknown field', { unexpected: true }],
] as const) {
	test(`snapshot refuses index state with ${label}`, async context => {
		const f = fixture(context); await f.repository.createCatalog(f.root);
		f.indexedDB.seedRecord(f.databaseName, 'catalogStates', { ...indexState(f.root, 0), ...changes }, f.root.id);
		await assert.rejects(f.repository.readSnapshot(f.root.id));
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	});
}

for (const [label, changes] of [
	['foreign identity', { id: 'another-catalog' }], ['future schema', { schemaVersion: 2 }],
	['unknown field', { unexpected: true }], ['invalid kind', { kind: 'unrecognized' }],
] as const) {
	test(`snapshot refuses a stored root with ${label}`, async context => {
		const f = fixture(context); await f.repository.createCatalog(f.root);
		f.indexedDB.seedRecord(f.databaseName, 'catalogs', { ...f.root, ...changes }, f.root.id);
		await assert.rejects(f.repository.readSnapshot(f.root.id));
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
	});
}

test('snapshot rejects a shape-valid root beyond the canonical persisted byte budget', async context => {
	const f = fixture(context); await f.repository.createCatalog(f.root);
	const root = { ...f.root, keywords: Array.from({ length: 10_000 }, (_, index) => ({
		id: `keyword-${index}`, name: 'x'.repeat(256), parentId: null })) };
	f.indexedDB.seedRecord(f.databaseName, 'catalogs', root);
	await assert.rejects(f.repository.readSnapshot(f.root.id), /byte budget/iu);
	assert.equal(f.indexedDB.stats.activeTransactions, 0);
});

test('pre-abort and cancellation of either point read preserve the native reason and release transactions', async context => {
	const f = fixture(context); await f.repository.createCatalog(f.root);
	const stop = new AbortController(), reason = new DOMException('Snapshot cancelled', 'AbortError'); stop.abort(reason);
	const before = f.indexedDB.stats.getRequests.length;
	await assert.rejects(f.repository.readSnapshot(f.root.id, { signal: stop.signal }), candidate => candidate === reason);
	assert.equal(f.indexedDB.stats.getRequests.length, before);
	for (const store of ['catalogs', 'catalogStates']) {
		const interrupted = new AbortController(), failure = new Error(`Interrupted ${store}`);
		f.indexedDB.onNextGetForStore(store, () => { interrupted.abort(failure); });
		await assert.rejects(f.repository.readSnapshot(f.root.id, { signal: interrupted.signal }), candidate => candidate === failure);
		assert.equal(f.indexedDB.stats.activeTransactions, 0);
		assert.deepEqual(await f.repository.readSnapshot(f.root.id), { catalog: f.root, indexRevision: 0 });
	}
});

test('snapshot reads reject after close and preserve their mutation fence across a fresh owner', async context => {
	const f = fixture(context); await f.repository.createCatalog(f.root);
	const photo = photoArchiveFixture().photo;
	await f.repository.publishPhotos(f.root.id, 0, [photo]); await f.repository.savePhoto({ ...photo, rating: 4 }, 0);
	const snapshot = await f.repository.readSnapshot(f.root.id);
	await f.repository.close(); await assert.rejects(f.repository.readSnapshot(f.root.id), { code: 'CATALOG_CLOSED' });
	const reopened = f.create(); context.after(async () => { await reopened.close(); });
	assert.deepEqual(await reopened.readSnapshot(f.root.id), snapshot);
	await assert.rejects(reopened.readSnapshot('../catalog'), /identifier/iu);
	assert.equal(f.indexedDB.stats.activeTransactions, 0);
});
