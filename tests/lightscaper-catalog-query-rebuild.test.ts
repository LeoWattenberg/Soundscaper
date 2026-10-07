/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { queryCatalogRootV1, queryPhotoV1 } from './helpers/lightscaper-catalog-query-fixture.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { photoSummary, indexState } from '../src/lightscaper/catalog/repository-records.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import type { PhotoDocumentV1 } from '../src/lightscaper/catalog/types.ts';

Object.defineProperty(globalThis, 'IDBKeyRange', { value: InstrumentedKeyRange, configurable: true });
async function legacy(photos: readonly PhotoDocumentV1[] = Array.from({ length: 43 }, (_, index) => queryPhotoV1(index))) {
	const indexedDB = createInstrumentedIndexedDB();
	const factory = indexedDB as unknown as IDBFactory;
	await new Promise<void>((resolve, reject) => {
		const opening = factory.open('legacy-query', 1);
		opening.onupgradeneeded = () => {
			for (const name of ['catalogs', 'catalogStates', 'photos', 'summaries', 'memberships']) {
				const store = opening.result.createObjectStore(name, { keyPath: name.startsWith('catalog') ? 'id' : 'key' });
				if (name === 'summaries') store.createIndex('catalogId', 'catalogId');
				if (name === 'memberships') store.createIndex('scope', 'scope');
			}
		};
		opening.onsuccess = () => { opening.result.close(); resolve(); }; opening.onerror = () => reject(opening.error);
	});
	const root = { ...queryCatalogRootV1(), revision: 1, photoCount: photos.length };
	indexedDB.seedRecord('legacy-query', 'catalogs', root); indexedDB.seedRecord('legacy-query', 'catalogStates', indexState(root, 1));
	for (const photo of photos) {
		indexedDB.seedRecord('legacy-query', 'photos', { key: `catalog|${photo.id}`, document: photo });
		indexedDB.seedRecord('legacy-query', 'summaries', photoSummary(photo));
	}
	const create = () => new PhotoCatalogRepositoryV1({ indexedDB: factory, databaseName: 'legacy-query', verifyOriginal: async () => undefined });
	return { indexedDB, repository: create(), create };
}

test('v1 upgrade preserves photos and legacy pages while refusing incomplete query indexes', async () => {
	const { repository, indexedDB } = await legacy();
	const before = indexedDB.records('legacy-query', 'photos');
	assert.equal((await repository.readSummaryPage('catalog')).items.length, 43);
	await assert.rejects(repository.readQueryPage('catalog'), { code: 'PHOTO_QUERY_INDEX_NOT_READY' });
	const first = await repository.rebuildQueryIndexPage('catalog');
	assert.equal(first.processed, 16); assert.equal(first.ready, false); assert.ok(first.bytes <= 8_388_608);
	assert.equal(indexedDB.recordCount('legacy-query', 'photoQueryRows'), 16);
	assert.deepEqual(indexedDB.records('legacy-query', 'photos'), before);
	assert.equal(indexedDB.stats.activeTransactions, 0); await repository.close();
});

test('rebuild resumes after reopen and atomically covers new writes behind the saved cursor', async () => {
	const { repository, indexedDB, create } = await legacy();
	await repository.rebuildQueryIndexPage('catalog'); await repository.close();
	const resumed = create();
	const first = (await resumed.loadPhoto('catalog', queryPhotoV1().id))!;
	await resumed.savePhoto({ ...first, rating: 5, metadata: { ...first.metadata, title: 'Current edit' } }, first.revision);
	const extra = { ...queryPhotoV1(99), id: 'photo-000001-added' };
	await resumed.publishPhotos('catalog', 1, [extra]);
	let ready = false; while (!ready) ready = (await resumed.rebuildQueryIndexPage('catalog')).ready;
	const page = await resumed.readQueryPage('catalog');
	assert.equal(page.items.length, 44); assert.ok(page.items.some((item) => item.photoId === extra.id));
	assert.equal(page.items.find((item) => item.photoId === first.id)!.rating, 5);
	assert.equal(indexedDB.recordCount('legacy-query', 'photoQueryRows'), 44);
	assert.deepEqual((await resumed.rebuildQueryIndexPage('catalog')), { processed: 0, bytes: 0, ready: true });
	assert.equal((await resumed.loadPhoto('catalog', first.id))!.original.contentSha256, first.original.contentSha256);
	await resumed.close();
});

test('row/progress write failure and cancellation roll back one rebuild step without losing resume state', async () => {
	const { repository, indexedDB } = await legacy(); await repository.rebuildQueryIndexPage('catalog');
	const before = indexedDB.records('legacy-query', 'photoQueryBuildStates');
	indexedDB.failNextPutForStore('photoQueryBuildStates', new Error('progress failed'));
	await assert.rejects(repository.rebuildQueryIndexPage('catalog'), /progress failed/u);
	assert.equal(indexedDB.recordCount('legacy-query', 'photoQueryRows'), 16);
	assert.deepEqual(indexedDB.records('legacy-query', 'photoQueryBuildStates'), before);
	const cancel = new AbortController(); indexedDB.onNextGetForStore('catalogStates', () => cancel.abort());
	await assert.rejects(repository.rebuildQueryIndexPage('catalog', { signal: cancel.signal }), { name: 'AbortError' });
	assert.deepEqual(indexedDB.records('legacy-query', 'photoQueryBuildStates'), before);
	assert.equal((await repository.rebuildQueryIndexPage('catalog')).processed, 16);
	assert.equal(indexedDB.stats.activeTransactions, 0); await repository.close();
});

test('rebuild source-byte budget stops before the next large photo and does not retain document pages', async () => {
	const seed = queryPhotoV1();
	const effects = Array.from({ length: 96 }, (_, index) => ({ id: `effect-${index}-${'x'.repeat(100)}`, type: 'color-adjust', enabled: true, params: {} }));
	const versions = Array.from({ length: 64 }, (_, index) => ({ ...seed.versions[0]!, id: `version-${index}`, kind: index === 0 ? 'master' : 'virtual-copy',
		develop: { ...defaultPhotoDevelopV1(), effects } }));
	const photos = Array.from({ length: 8 }, (_, index) => normalizePhotoDocumentV1({ ...queryPhotoV1(index), activeVersionId: 'version-0', versions }));
	const { repository, indexedDB } = await legacy(photos);
	const page = await repository.rebuildQueryIndexPage('catalog');
	assert.ok(page.processed > 0 && page.processed < 8); assert.ok(page.bytes <= 8_388_608); assert.equal(page.ready, false);
	assert.equal(indexedDB.recordCount('legacy-query', 'photoQueryRows'), page.processed);
	assert.ok(indexedDB.stats.cursorRequests.every((entry: { delivered: number }) => entry.delivered <= 17));
	let ready = false; while (!ready) ready = (await repository.rebuildQueryIndexPage('catalog')).ready;
	assert.equal((await repository.readQueryPage('catalog')).items.length, 8); await repository.close();
});

test('future/malformed source documents abort rebuild and incomplete source counts never claim readiness', async () => {
	const { repository, indexedDB } = await legacy([queryPhotoV1()]);
	indexedDB.seedRecord('legacy-query', 'photos', { key: `catalog|${queryPhotoV1().id}`, document: { ...queryPhotoV1(), schemaVersion: 2 } });
	await assert.rejects(repository.rebuildQueryIndexPage('catalog'), /future/iu);
	assert.equal(indexedDB.recordCount('legacy-query', 'photoQueryRows'), 0);
	indexedDB.seedRecord('legacy-query', 'photos', { key: `catalog|${queryPhotoV1().id}`, document: queryPhotoV1() });
	const root = { ...queryCatalogRootV1(), revision: 1, photoCount: 2 };
	indexedDB.seedRecord('legacy-query', 'catalogs', root); indexedDB.seedRecord('legacy-query', 'catalogStates', indexState(root, 1));
	await assert.rejects(repository.rebuildQueryIndexPage('catalog'), /count/iu);
	await assert.rejects(repository.readQueryPage('catalog'), { code: 'PHOTO_QUERY_INDEX_NOT_READY' }); await repository.close();
});

test('query and rebuild reject shape-valid roots above the canonical 2 MiB budget before cursor work', async () => {
	const { repository, indexedDB } = await legacy([]);
	await repository.loadCatalog('catalog');
	const root = { ...queryCatalogRootV1(), revision: 1, photoCount: 0,
		keywords: Array.from({ length: 10_000 }, (_, index) => ({ id: `keyword-${index}`, name: 'x'.repeat(256), parentId: null })) };
	root.keywords[0] = { ...root.keywords[0]!, id: 'keyword' };
	indexedDB.seedRecord('legacy-query', 'catalogs', root); indexedDB.seedRecord('legacy-query', 'catalogStates', indexState(root, 1));
	const before = indexedDB.stats.cursorRequests.length;
	await assert.rejects(repository.readQueryPage('catalog'), /byte budget/iu);
	await assert.rejects(repository.rebuildQueryIndexPage('catalog'), /byte budget/iu);
	assert.equal(indexedDB.stats.cursorRequests.length, before);
	assert.equal(indexedDB.recordCount('legacy-query', 'photoQueryRows'), 0); await repository.close();
});

test('rebuild readiness never performs an unbounded scoped count scan', async () => {
	const { repository, indexedDB } = await legacy([queryPhotoV1()]);
	assert.equal((await repository.rebuildQueryIndexPage('catalog')).ready, true);
	assert.equal(indexedDB.stats.countRequests.length, 0); await repository.close();
});
