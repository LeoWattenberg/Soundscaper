/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { defaultPhotoDevelopV1 } from '../src/lightscaper/catalog/develop-state.ts';
import { emptyPhotoMetadataV1 } from '../src/lightscaper/catalog/photo-metadata.ts';
import { normalizePhotoDocumentV1 } from '../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import type { PhotoOriginalV1 } from '../src/lightscaper/catalog/types.ts';
import { indexState, photoStorageKey, photoSummary } from '../src/lightscaper/catalog/repository-records.ts';
import { serializeLightscaperDocumentV1 } from '../src/lightscaper/catalog/documents.ts';

type DatabaseHarness = Omit<ReturnType<typeof createInstrumentedIndexedDB>, 'stats'> & {
	readonly stats: Omit<ReturnType<typeof createInstrumentedIndexedDB>['stats'], 'getRequests' | 'cursorRequests'> & {
		readonly getRequests: { readonly store: string }[];
		readonly cursorRequests: { readonly store: string; readonly delivered: number }[];
	};
};

function root() {
	return normalizePhotoCatalogRootV1({
		schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: 'catalog',
		name: 'Test', revision: 0, photoCount: 0,
		folders: [{ id: 'folder', name: 'Virtual', parentId: null }],
		keywords: [{ id: 'keyword', name: 'Keyword', parentId: null }],
		collections: [{ id: 'collection', name: 'Collection', kind: 'manual' }],
	});
}

function photo(index = 0) {
	const id = `photo-${String(index).padStart(6, '0')}`;
	return normalizePhotoDocumentV1({
		schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo', id, catalogId: 'catalog', revision: 0,
		original: {
			schemaVersion: 1, kind: 'still', id: `source-${String(index)}`, name: `${id}.jpg`,
			mimeType: 'image/jpeg', storageKey: `original-${String(index)}`, contentSha256: 'a'.repeat(64),
			width: 100, height: 100, hasAlpha: false, byteLength: 123, retention: 'managed',
		},
		metadata: emptyPhotoMetadataV1(`${id}.jpg`), folderId: 'folder', collectionIds: ['collection'],
		keywordIds: ['keyword'], rating: index % 6, flag: 'unflagged', colorLabel: 'none',
		activeVersionId: 'master', versions: [{ id: 'master', kind: 'master', name: 'Original',
			createdAt: '2026-01-01T00:00:00.000Z', develop: defaultPhotoDevelopV1() }],
	});
}

function fixture(verifyOriginal: (original: PhotoOriginalV1) => Promise<void> = async () => undefined) {
	const indexedDB = createInstrumentedIndexedDB() as DatabaseHarness;
	const repository = new PhotoCatalogRepositoryV1({
		indexedDB: indexedDB as unknown as IDBFactory,
		databaseName: 'lightscaper-test', verifyOriginal,
	});
	return { indexedDB, repository };
}

test('catalog publication stores only owned catalog stores and survives reopening with detached state', async () => {
	const { indexedDB, repository } = fixture();
	await repository.createCatalog(root());
	await repository.publishPhotos('catalog', 0, [photo()]);
	const loaded = await repository.loadPhoto('catalog', photo().id);
	assert.equal(loaded?.original.contentSha256, photo().original.contentSha256);
	assert.equal(Object.isFrozen(loaded?.metadata), true);
	assert.equal((await repository.loadCatalog('catalog'))?.photoCount, 1);
	assert.equal((await repository.loadCatalog('catalog'))?.revision, 1);
	assert.equal(indexedDB.recordCount('lightscaper-test', 'projects'), 0);
	assert.equal(indexedDB.recordCount('lightscaper-test', 'photos'), 1);
	await repository.close();
	await repository.close();
	await assert.rejects(repository.loadCatalog('catalog'), { code: 'CATALOG_CLOSED' });
	const reopened = new PhotoCatalogRepositoryV1({ indexedDB: indexedDB as unknown as IDBFactory,
		databaseName: 'lightscaper-test', verifyOriginal: async () => undefined });
	assert.deepEqual(await reopened.loadPhoto('catalog', photo().id), loaded);
	await reopened.close();
});

test('root and photo compare-and-swap reject stale writes and preserve other aggregates', async () => {
	const { repository } = fixture();
	await repository.createCatalog(root());
	await repository.publishPhotos('catalog', 0, [photo(), photo(1)]);
	const updated = await repository.savePhoto({ ...photo(), rating: 5 }, 0);
	assert.equal(updated.revision, 1);
	await assert.rejects(repository.savePhoto({ ...photo(), rating: 1 }, 0), { code: 'PHOTO_REVISION_CONFLICT' });
	assert.equal((await repository.loadPhoto('catalog', photo().id))?.rating, 5);
	assert.deepEqual(await repository.loadPhoto('catalog', photo(1).id), photo(1));
	await assert.rejects(repository.publishPhotos('catalog', 0, [photo(2)]), { code: 'CATALOG_REVISION_CONFLICT' });
	await assert.rejects(repository.savePhoto({ ...updated, original: { ...updated.original, contentSha256: 'b'.repeat(64) } }, 1), /original/iu);
	await repository.close();
});

test('any import store failure rolls back count, photo rows, summaries and membership indexes', async () => {
	for (const store of ['photos', 'summaries', 'memberships', 'catalogStates', 'catalogs']) {
		const { indexedDB, repository } = fixture();
		await repository.createCatalog(root());
		indexedDB.failNextPutForStore(store, new DOMException('quota refused', 'QuotaExceededError'));
		await assert.rejects(repository.publishPhotos('catalog', 0, [photo(), photo(1)]), { name: 'QuotaExceededError' });
		assert.equal((await repository.loadCatalog('catalog'))?.photoCount, 0, store);
		for (const name of ['photos', 'summaries', 'memberships']) assert.equal(indexedDB.recordCount('lightscaper-test', name), 0, store);
		assert.equal(indexedDB.stats.activeTransactions, 0);
		await repository.close();
	}
});

test('failed photo edits roll back both summary and scoped membership changes', async () => {
	const { indexedDB, repository } = fixture();
	await repository.createCatalog(root());
	await repository.publishPhotos('catalog', 0, [photo()]);
	indexedDB.failNextPutForStore('summaries', new Error('summary unavailable'));
	await assert.rejects(repository.savePhoto({ ...photo(), rating: 5, folderId: null, keywordIds: [] }, 0), /summary unavailable/u);
	assert.deepEqual(await repository.loadPhoto('catalog', photo().id), photo());
	const result = await repository.readSummaryPage('catalog', { filter: { kind: 'keyword', id: 'keyword' } });
	assert.equal(result.items.length, 1);
	assert.equal(result.items[0]?.rating, 0);
	await repository.close();
});

test('original custody failure and cancellation publish no partial catalog mutation', async () => {
	let verificationCalls = 0;
	const { repository } = fixture(async () => { verificationCalls += 1; throw new Error('original missing'); });
	await repository.createCatalog(root());
	await assert.rejects(repository.publishPhotos('catalog', 0, [photo()]), /original missing/u);
	assert.equal(verificationCalls, 1);
	assert.equal((await repository.loadCatalog('catalog'))?.photoCount, 0);
	await repository.close();
	const abort = new AbortController();
	const next = fixture(async () => { abort.abort(); });
	await next.repository.createCatalog(root());
	await assert.rejects(next.repository.publishPhotos('catalog', 0, [photo()], { signal: abort.signal }), { name: 'AbortError' });
	assert.equal((await next.repository.loadCatalog('catalog'))?.photoCount, 0);
	await next.repository.close();
	const active = fixture();
	await active.repository.createCatalog(root());
	const midWrite = new AbortController();
	active.indexedDB.onNextGetForStore('catalogs', () => midWrite.abort());
	await assert.rejects(active.repository.publishPhotos('catalog', 0, [photo()], { signal: midWrite.signal }), { name: 'AbortError' });
	assert.equal(active.indexedDB.recordCount('lightscaper-test', 'photos'), 0);
	await active.repository.close();
});

test('bounded summary pages use cursor indexes, never fetch photo/develop aggregates, and release transactions', async () => {
	const { indexedDB, repository } = fixture();
	await repository.createCatalog(root());
	let revision = 0;
	for (let offset = 0; offset < 80; offset += 16) {
		await repository.publishPhotos('catalog', revision, Array.from({ length: 16 }, (_, index) => photo(offset + index)));
		revision += 1;
	}
	const getBefore = indexedDB.stats.getRequests.length;
	const first = await repository.readSummaryPage('catalog');
	assert.equal(first.items.length, 64);
	assert.ok(first.continuation);
	assert.equal(indexedDB.stats.activeTransactions, 0);
	assert.equal(Object.hasOwn(first.items[0]!, 'develop'), false);
	const next = await repository.readSummaryPage('catalog', { continuation: first.continuation });
	assert.equal(next.items.length, 16);
	assert.equal(next.continuation, null);
	assert.equal(new Set([...first.items, ...next.items].map((item) => item.photoId)).size, 80);
	assert.equal(indexedDB.stats.getRequests.slice(getBefore).some((entry) => entry.store === 'photos'), false);
	assert.equal(indexedDB.stats.getAllRequests.length, 0);
	assert.ok(indexedDB.stats.cursorRequests.every((entry) => entry.delivered <= 66));
	await assert.rejects(repository.readSummaryPage('catalog', { continuation: { ...first.continuation!, catalogId: 'other' } }), /continuation/iu);
	await repository.publishPhotos('catalog', revision, [photo(99)]);
	await assert.rejects(repository.readSummaryPage('catalog', { continuation: first.continuation }), { code: 'CATALOG_REVISION_CONFLICT' });
	await repository.close();
});

test('publication rejects duplicate IDs, oversized batches, stale candidate revisions and dangling taxonomy', async () => {
	const { repository } = fixture();
	await repository.createCatalog(root());
	await assert.rejects(repository.publishPhotos('catalog', 0, [photo(), photo()]), /duplicate/iu);
	await assert.rejects(repository.publishPhotos('catalog', 0, Array.from({ length: 17 }, (_, index) => photo(index))), /16/iu);
	await assert.rejects(repository.publishPhotos('catalog', 0, [{ ...photo(), revision: 1 }]), /revision/iu);
	await assert.rejects(repository.publishPhotos('catalog', 0, [{ ...photo(), folderId: 'missing' }]), /missing/iu);
	await repository.publishPhotos('catalog', 0, [photo()]);
	await assert.rejects(repository.publishPhotos('catalog', 1, [photo()]), /exists/iu);
	assert.equal((await repository.loadCatalog('catalog'))?.photoCount, 1);
	await repository.close();
});

test('virtual folder renaming uses root CAS without rewriting photos, and referenced nodes cannot disappear', async () => {
	const { repository, indexedDB } = fixture();
	await repository.createCatalog(root());
	const catalog = await repository.publishPhotos('catalog', 0, [photo()]);
	const writesBefore = indexedDB.records('lightscaper-test', 'photos');
	const renamed = await repository.saveCatalog({ ...catalog, folders: [{ ...catalog.folders[0]!, name: 'Renamed' }] }, 1);
	assert.equal(renamed.revision, 2);
	assert.deepEqual(indexedDB.records('lightscaper-test', 'photos'), writesBefore);
	await assert.rejects(repository.saveCatalog(catalog, 1), { code: 'CATALOG_REVISION_CONFLICT' });
	await assert.rejects(repository.saveCatalog({ ...renamed, photoCount: 0 }, 2), /count/iu);
	const removalCursors = indexedDB.stats.cursorRequests.length;
	await assert.rejects(repository.saveCatalog({ ...renamed, folders: [] }, 2), /referenced/iu);
	await assert.rejects(repository.saveCatalog({ ...renamed, collections: [{ id: 'collection', name: 'Smart', kind: 'smart', query: { kind: 'rating', minimum: 0, maximum: 5 } }] }, 2), /referenced/iu);
	assert.equal(indexedDB.stats.cursorRequests.length - removalCursors, 2);
	assert.ok(indexedDB.stats.cursorRequests.slice(removalCursors).every((cursor) => cursor.delivered === 1), 'removal checks stop at the first reference');
	indexedDB.failNextPutForStore('catalogStates', new Error('state failed'));
	await assert.rejects(repository.saveCatalog({ ...renamed, name: 'Failed' }, 2), /state failed/u);
	assert.deepEqual(await repository.loadCatalog('catalog'), renamed);
	await repository.close();
});

test('100,000 photo references page through the summary index without loading photo aggregates', { timeout: 60_000 }, async () => {
	const { repository, indexedDB } = fixture();
	await repository.createCatalog(root());
	const largeRoot = normalizePhotoCatalogRootV1({ ...root(), revision: 1, photoCount: 100_000 });
	indexedDB.seedRecord('lightscaper-test', 'catalogs', largeRoot);
	indexedDB.seedRecord('lightscaper-test', 'catalogStates', indexState(largeRoot, 1));
	const template = photo();
	for (let index = 0; index < 100_000; index += 1) {
		const id = `photo-${String(index).padStart(6, '0')}`;
		const item = { ...template, id, rating: index % 6,
			original: { ...template.original, id: `source-${String(index)}`, storageKey: `original-${String(index)}`, name: `${id}.jpg` },
			metadata: { ...template.metadata, fileName: `${id}.jpg` } };
		indexedDB.seedRecord('lightscaper-test', 'photos', { key: photoStorageKey('catalog', id), document: item });
		indexedDB.seedRecord('lightscaper-test', 'summaries', photoSummary(item));
	}
	const first = await repository.readSummaryPage('catalog');
	assert.equal(first.items.length, 64);
	assert.equal(first.items[0]?.photoId, 'photo-000000');
	const distant = await repository.readSummaryPage('catalog', { continuation: {
		...first.continuation!, afterKey: photoStorageKey('catalog', 'photo-095000'),
	} });
	assert.equal(distant.items.length, 64);
	assert.equal(distant.items[0]?.photoId, 'photo-095001');
	assert.equal(indexedDB.stats.getRequests.some((entry) => entry.store === 'photos'), false);
	assert.equal(indexedDB.stats.getAllRequests.length, 0);
	assert.ok(indexedDB.stats.cursorRequests.every((entry) => entry.delivered <= 66));
	assert.equal(indexedDB.stats.activeTransactions, 0);
	assert.equal(indexedDB.recordCount('lightscaper-test', 'photos'), 100_000);
	await repository.close();
});

test('dense photo memberships remain valid individually and import batches must split at the write budget', async () => {
	let verified = 0;
	const { repository } = fixture(async () => { verified += 1; });
	const nodes = Array.from({ length: 1_024 }, (_, index) => ({ id: `k-${String(index)}`, name: `Keyword ${String(index)}`, parentId: null }));
	const collections = Array.from({ length: 1_024 }, (_, index) => ({ id: `c-${String(index)}`, name: `Collection ${String(index)}`, kind: 'manual' }));
	await repository.createCatalog({ ...root(), keywords: nodes, collections });
	const dense = { ...photo(), keywordIds: nodes.map((node) => node.id), collectionIds: collections.map((collection) => collection.id) };
	await assert.rejects(repository.publishPhotos('catalog', 0, [dense, { ...dense, id: 'dense-2' }]), /membership.*budget/iu);
	assert.equal(verified, 0, 'batch admission precedes original resource work');
	await repository.publishPhotos('catalog', 0, [dense]);
	assert.equal((await repository.readSummaryPage('catalog', { filter: { kind: 'keyword', id: 'k-1023' } })).items.length, 1);
	await repository.close();
});

test('large legal photo aggregates reject an over-budget publication batch before custody work', async () => {
	let verified = 0;
	const { repository } = fixture(async () => { verified += 1; });
	await repository.createCatalog(root());
	const effects = Array.from({ length: 96 }, (_, index) => ({
		id: `effect-${String(index)}-${'x'.repeat(100)}`, type: 'color-adjust', enabled: true, params: {},
	}));
	const versions = Array.from({ length: 64 }, (_, index) => ({ ...photo().versions[0]!,
		id: `version-${String(index)}`, kind: index === 0 ? 'master' : 'virtual-copy', develop: { ...defaultPhotoDevelopV1(), effects },
	}));
	const large = { ...photo(), activeVersionId: 'version-0', versions };
	const size = new TextEncoder().encode(serializeLightscaperDocumentV1(large)).byteLength;
	assert.ok(size <= 2_097_152 && size * 6 > 8_388_608);
	await assert.rejects(repository.publishPhotos('catalog', 0, Array.from({ length: 6 }, (_, index) => ({ ...large, id: `large-${String(index)}` }))), /byte.*budget/iu);
	assert.equal(verified, 0);
	assert.equal((await repository.loadCatalog('catalog'))?.photoCount, 0);
	await repository.close();
});

test('persisted corruption, future schema and cross-scope continuation tokens fail closed', async () => {
	const { repository, indexedDB } = fixture();
	await repository.createCatalog(root());
	await repository.publishPhotos('catalog', 0, [photo()]);
	const key = photoStorageKey('catalog', photo().id);
	indexedDB.seedRecord('lightscaper-test', 'photos', { key, document: { ...photo(), schemaVersion: 2 } });
	await assert.rejects(repository.loadPhoto('catalog', photo().id), /future/iu);
	indexedDB.seedRecord('lightscaper-test', 'summaries', { ...photoSummary(photo()), develop: {} });
	await assert.rejects(repository.readSummaryPage('catalog'), /unsupported/iu);
	indexedDB.seedRecord('lightscaper-test', 'summaries', photoSummary(photo()));
	await assert.rejects(repository.readSummaryPage('missing'), /missing/iu);
	await assert.rejects(repository.readSummaryPage('catalog', { continuation: { catalogId: 'catalog', indexRevision: 1, scope: 'catalog|rating|5', afterKey: 'catalog|photo-000000' } }), /continuation/iu);
	indexedDB.seedRecord('lightscaper-test', 'catalogStates', { ...indexState({ ...root(), revision: 1, photoCount: 1 }, 1), schemaVersion: 2 });
	await assert.rejects(repository.readSummaryPage('catalog'), /future/iu);
	await repository.close();
});

test('root revision growth cannot publish a document beyond the persisted byte limit', async () => {
	const { repository, indexedDB } = fixture();
	const folders = [...root().folders, ...Array.from({ length: 7_000 }, (_, index) => ({
		id: `node-${String(index)}`, name: 'x', parentId: null,
	}))];
	const candidate = { ...root(), revision: 9, folders };
	let remaining = 2_097_152 - new TextEncoder().encode(JSON.stringify(candidate)).byteLength;
	for (let index = 1; index < folders.length && remaining > 0; index += 1) {
		const extra = Math.min(255, remaining);
		folders[index] = { ...folders[index]!, name: 'x'.repeat(1 + extra) };
		remaining -= extra;
	}
	assert.equal(remaining, 0);
	assert.equal(new TextEncoder().encode(serializeLightscaperDocumentV1(candidate)).byteLength, 2_097_152);
	await repository.createCatalog({ ...candidate, revision: 0 });
	indexedDB.seedRecord('lightscaper-test', 'catalogs', candidate);
	indexedDB.seedRecord('lightscaper-test', 'catalogStates', indexState(candidate, 9));
	await assert.rejects(repository.saveCatalog(candidate, 9), /byte budget/iu);
	await assert.rejects(repository.publishPhotos('catalog', 9, [photo()]), /byte budget/iu);
	assert.equal((await repository.loadCatalog('catalog'))?.revision, 9);
	assert.equal(indexedDB.recordCount('lightscaper-test', 'photos'), 0);
	await repository.close();
});

test('repository admission requires durable IndexedDB and a trusted original verifier', () => {
	assert.throws(() => new PhotoCatalogRepositoryV1({ indexedDB: null as unknown as IDBFactory, verifyOriginal: async () => undefined }), /durable/iu);
	assert.throws(() => new PhotoCatalogRepositoryV1({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, verifyOriginal: null as unknown as (original: PhotoOriginalV1) => Promise<void> }), /custody/iu);
});

test('a failed durable database open can be retried on the same live repository', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	let attempts = 0;
	const factory = { open: (name: string, version: number) => {
		attempts += 1;
		if (attempts === 1) throw new DOMException('Temporary storage refusal', 'UnknownError');
		return indexedDB.open(name, version);
	} };
	const repository = new PhotoCatalogRepositoryV1({ indexedDB: factory as unknown as IDBFactory,
		databaseName: 'retry-test', verifyOriginal: async () => undefined });
	await assert.rejects(repository.createCatalog(root()), { name: 'UnknownError' });
	await repository.createCatalog(root());
	assert.equal(attempts, 2);
	assert.equal((await repository.loadCatalog('catalog'))?.id, 'catalog');
	await repository.close();
});
