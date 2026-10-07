/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { projectPhotoQueryRowV1 } from '../src/lightscaper/catalog/photo-query-index-v1.ts';
import { normalizePhotoCatalogQueryV1, type PhotoCatalogQueryV1, type PhotoQueryContinuationV1 } from '../src/lightscaper/catalog/photo-query-types-v1.ts';
import { indexState, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { qualifyCatalogQueryScaleNativeV1 } from './helpers/lightscaper-catalog-query-native-fixture.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
type Harness = ReturnType<typeof createInstrumentedIndexedDB>;
function fixture() {
	const indexedDB = createInstrumentedIndexedDB();
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory,
		databaseName: 'query-test', verifyOriginal: async () => undefined });
	return { indexedDB, repository };
}
async function fill(repository: PhotoCatalogRepositoryV1, count: number) {
	await repository.createCatalog(queryCatalogRootV1());
	for (let offset = 0, revision = 0; offset < count; offset += 16, revision++) {
		await repository.publishPhotos('catalog', revision, Array.from({ length: Math.min(16, count - offset) }, (_, index) => queryPhotoV1(offset + index)));
	}
}
async function collect(repository: PhotoCatalogRepositoryV1, query: PhotoCatalogQueryV1) {
	const ids: string[] = [];
	let continuation: PhotoQueryContinuationV1 | null = null;
	let empty = 0;
	do {
		const page = await repository.readQueryPage('catalog', { query, continuation });
		assert.ok(page.items.length <= 64 && page.scanned <= 64);
		if (page.items.length === 0 && page.continuation) empty++;
		ids.push(...page.items.map((item) => item.photoId));
		continuation = page.continuation;
	} while (continuation);
	return { ids, empty };
}
const query = (field: PhotoCatalogQueryV1['sort']['field'] = 'file-name', direction: 'ascending' | 'descending' = 'ascending') =>
	normalizePhotoCatalogQueryV1({ sort: { field, direction } });

test('global filename and rating order crosses pages and keeps deterministic ties', async () => {
	const { repository, indexedDB } = fixture(); await fill(repository, 145);
	const expected = Array.from({ length: 145 }, (_, index) => queryPhotoV1(index));
	assert.deepEqual((await collect(repository, query())).ids, expected.slice().reverse().map((photo) => photo.id));
	for (const direction of ['ascending', 'descending'] as const) {
		const sorted = expected.slice().sort((a, b) => a.rating - b.rating || (a.id < b.id ? -1 : 1));
		if (direction === 'descending') sorted.reverse();
		assert.deepEqual((await collect(repository, query('rating', direction))).ids, sorted.map((photo) => photo.id));
	}
	assert.equal(indexedDB.stats.getAllRequests.length, 0);
	assert.equal(indexedDB.stats.activeTransactions, 0); await repository.close();
});

test('capture order explicitly puts unknowns last in both directions without timezone inference', async () => {
	const { repository } = fixture(); await fill(repository, 90);
	for (const direction of ['ascending', 'descending'] as const) {
		const photos = Array.from({ length: 90 }, (_, index) => queryPhotoV1(index));
		const known = photos.filter((photo) => photo.metadata.captureTime).sort((a, b) =>
			(a.metadata.captureTime!.local < b.metadata.captureTime!.local ? -1 : a.metadata.captureTime!.local > b.metadata.captureTime!.local ? 1 : 0) || (a.id < b.id ? -1 : 1));
		const unknown = photos.filter((photo) => !photo.metadata.captureTime);
		if (direction === 'descending') { known.reverse(); unknown.reverse(); }
		assert.deepEqual((await collect(repository, query('capture-time', direction))).ids, [...known, ...unknown].map((photo) => photo.id));
	}
	await repository.close();
});

test('text search finds distant metadata and keyword names through truthful empty continuation steps', async () => {
	const { repository, indexedDB } = fixture(); await fill(repository, 160);
	const target = await repository.loadPhoto('catalog', queryPhotoV1(155).id);
	await repository.savePhoto({ ...target!, metadata: { ...target!.metadata, caption: 'DISTANT café', title: 'Cross', creator: 'Boundary' } }, target!.revision);
	const getBefore = indexedDB.stats.getRequests.length;
	const searched = await collect(repository, normalizePhotoCatalogQueryV1({ text: 'café', sort: { field: 'photo-id', direction: 'ascending' } }));
	assert.deepEqual(searched.ids, [target!.id]); assert.ok(searched.empty >= 2);
	assert.equal(indexedDB.stats.getRequests.slice(getBefore).some((entry: { store: string }) => entry.store === 'photos'), false);
	assert.equal((await collect(repository, normalizePhotoCatalogQueryV1({ text: 'CrossBoundary' }))).ids.length, 0);
	assert.equal((await collect(repository, normalizePhotoCatalogQueryV1({ text: 'LANDSCAPE' }))).ids.length, 80);
	await repository.close();
});

test('smart collection results evaluate current root predicates and change after photo and definition edits', async () => {
	const { repository } = fixture(); await fill(repository, 80);
	const smart = normalizePhotoCatalogQueryV1({ filter: { kind: 'collection', id: 'smart' } });
	const expected = Array.from({ length: 80 }, (_, index) => queryPhotoV1(index)).filter((photo) => photo.rating >= 4 && photo.keywordIds.length > 0).map((photo) => photo.id);
	assert.deepEqual((await collect(repository, smart)).ids, expected);
	const photo = (await repository.loadPhoto('catalog', expected[0]!))!;
	await repository.savePhoto({ ...photo, flag: 'reject' }, photo.revision);
	assert.deepEqual((await collect(repository, smart)).ids, expected.slice(1));
	const root = (await repository.loadCatalog('catalog'))!;
	await repository.saveCatalog({ ...root, collections: root.collections.map((collection) => collection.id === 'smart'
		? { ...collection, kind: 'smart', query: { kind: 'flag', value: 'reject' } } : collection) }, root.revision);
	assert.deepEqual((await collect(repository, smart)).ids, [photo.id]);
	await assert.rejects(repository.readSummaryPage('catalog', { filter: { kind: 'collection', id: 'smart' } }), /smart.*query/iu);
	assert.equal((await collect(repository, normalizePhotoCatalogQueryV1({ filter: { kind: 'collection', id: 'manual' } }))).ids.length, 80);
	await repository.close();
});

test('closed query and continuation boundaries refuse hostile getters, tampering, future and stale queries', async () => {
	let getters = 0; const hostile = { get text() { getters++; return 'x'; } };
	assert.throws(() => normalizePhotoCatalogQueryV1(hostile), /data property/iu); assert.equal(getters, 0);
	assert.throws(() => normalizePhotoCatalogQueryV1({ text: 'x'.repeat(257) }), /bounded/iu);
	const { repository } = fixture(); await fill(repository, 65);
	const first = await repository.readQueryPage('catalog', { query: query() }); assert.ok(first.continuation);
	await assert.rejects(repository.readQueryPage('catalog', { query: query('rating'), continuation: first.continuation }), /continuation/iu);
	await assert.rejects(repository.readQueryPage('catalog', { query: query(), continuation: { ...first.continuation!, schemaVersion: 2 } }), /future|version/iu);
	await assert.rejects(repository.readQueryPage('catalog', { query: query(), continuation: { ...first.continuation!, afterKey: ['other', 'x', 'photo-1'] } }), /continuation|catalog/iu);
	const changed = (await repository.loadPhoto('catalog', queryPhotoV1().id))!;
	await repository.savePhoto({ ...changed, rating: 5 }, changed.revision);
	await assert.rejects(repository.readQueryPage('catalog', { query: query(), continuation: first.continuation }), { code: 'CATALOG_REVISION_CONFLICT' });
	await repository.close();
});

test('query index publication and edits roll back atomically on write failure and cancellation', async () => {
	const { repository, indexedDB } = fixture(); await repository.createCatalog(queryCatalogRootV1());
	indexedDB.failNextPutForStore('photoQueryRows', new Error('query index full'));
	await assert.rejects(repository.publishPhotos('catalog', 0, [queryPhotoV1()]), /index full/u);
	assert.equal((await repository.loadCatalog('catalog'))!.photoCount, 0);
	assert.equal(indexedDB.recordCount('query-test', 'photos'), 0);
	await repository.publishPhotos('catalog', 0, [queryPhotoV1()]);
	indexedDB.failNextPutForStore('photoQueryRows', new Error('query edit failed'));
	await assert.rejects(repository.savePhoto({ ...queryPhotoV1(), rating: 5 }, 0), /edit failed/u);
	assert.equal((await repository.readQueryPage('catalog')).items[0]!.rating, 0);
	const cancel = new AbortController(); indexedDB.onNextGetForStore('catalogStates', () => cancel.abort());
	await assert.rejects(repository.savePhoto({ ...queryPhotoV1(), rating: 4 }, 0, { signal: cancel.signal }), { name: 'AbortError' });
	assert.equal(indexedDB.stats.activeTransactions, 0); await repository.close();
});

test('maximal valid Unicode filename folding emits a reusable bounded continuation', async () => {
	const { repository } = fixture(); await repository.createCatalog(queryCatalogRootV1());
	const fileName = 'İ'.repeat(256);
	for (let offset = 0; offset < 65; offset += 16) {
		await repository.publishPhotos('catalog', offset / 16, Array.from({ length: Math.min(16, 65 - offset) }, (_, index) => {
			const photo = queryPhotoV1(offset + index); return { ...photo, metadata: { ...photo.metadata, fileName } };
		}));
	}
	const first = await repository.readQueryPage('catalog', { query: query() });
	assert.equal(first.continuation!.afterKey![1], fileName.toLowerCase());
	assert.ok(new TextEncoder().encode(JSON.stringify(first.continuation)).byteLength <= 2_048);
	const second = await repository.readQueryPage('catalog', { query: query(), continuation: first.continuation });
	assert.equal(second.items.length, 1); assert.equal(second.items[0]!.photoId, queryPhotoV1(64).id); await repository.close();
});

test('100,000 indexed query references keep bounded delivery and never read aggregates', { timeout: 60_000 }, async () => {
	const { repository, indexedDB } = fixture(); await repository.createCatalog(queryCatalogRootV1());
	const root = { ...queryCatalogRootV1(), revision: 1, photoCount: 100_000 };
	indexedDB.seedRecord('query-test', 'catalogs', root); indexedDB.seedRecord('query-test', 'catalogStates', indexState(root, 1));
	indexedDB.seedRecord('query-test', 'photoQueryBuildStates', { id: 'catalog', schemaVersion: 1, ready: true, afterKey: null, indexedCount: 100_000 });
	for (let index = 0; index < 100_000; index++) {
		const photo = queryPhotoV1(index); indexedDB.seedRecord('query-test', 'photoQueryRows', projectPhotoQueryRowV1(photo));
		indexedDB.seedRecord('query-test', 'summaries', photoSummary(photo));
	}
	const first = await repository.readQueryPage('catalog', { query: query() });
	assert.equal(first.items.length, 64); assert.equal(first.items[0]!.photoId, 'photo-099999');
	const next = await repository.readQueryPage('catalog', { query: query(), continuation: first.continuation });
	assert.equal(next.items[0]!.photoId, 'photo-099935');
	assert.equal(indexedDB.stats.getAllRequests.length, 0);
	assert.equal(indexedDB.stats.getRequests.some((entry: { store: string }) => entry.store === 'photos'), false);
	assert.ok(indexedDB.stats.cursorRequests.every((entry: { delivered: number }) => entry.delivered <= 64));
	assert.equal(indexedDB.stats.activeTransactions, 0); await repository.close();
});

export type QueryDatabaseHarness = Harness;
test('native query fixture is part of the strict test closure without opening browser storage', () => {
	assert.equal(typeof qualifyCatalogQueryScaleNativeV1, 'function');
});
