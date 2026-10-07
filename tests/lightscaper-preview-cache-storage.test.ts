/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { planPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { preparePhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import type { qualifyPhotoPreviewCacheNativeV1 } from './helpers/lightscaper-preview-cache-native-fixture.ts';

const nativeModes = { reopen: 'reopen', fault: 'fault' } satisfies Record<string, Parameters<typeof qualifyPhotoPreviewCacheNativeV1>[0]>;

function fixture() {
	const indexedDB = createInstrumentedIndexedDB(), databaseName = `lightscaper-preview-store-${crypto.randomUUID()}`;
	const create = () => new PhotoMediaStoreV1({ indexedDB: indexedDB as unknown as IDBFactory, databaseName, locks: null, preferOpfs: false });
	return { indexedDB, databaseName, create };
}

async function preview(index = 1) {
	const photo = photoArchiveFixture(index).photo;
	const binding = { catalogId: photo.catalogId, photoId: photo.id, originalId: photo.original.id, storageKey: photo.original.storageKey,
		contentSha256: photo.original.contentSha256, byteLength: photo.original.byteLength, width: 1, height: 1 };
	const frame = { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' }, pixels: Uint8Array.from([12, 34, 56, 255]) };
	const plan = planPhotoPreviewV1({ binding, source: frame.descriptor, tier: 'thumbnail' });
	return { plan, prepared: await preparePhotoPreviewV1({ plan, binding, frame }) };
}

test(`the narrow preview cache survives ${nativeModes.reopen} independently of original custody and photo state`, async () => {
	const current = fixture(), store = current.create(), source = photoArchiveFixture(), value = await preview();
	const catalog = new PhotoCatalogRepositoryV1({ indexedDB: current.indexedDB as unknown as IDBFactory,
		databaseName: `preview-catalog-${crypto.randomUUID()}`, verifyOriginal: store.verifyOriginal });
	try {
		const originalPort = Object.keys(store.mediaRepository).sort();
		const cache = store.getPreviewCache(); assert.equal(cache, store.getPreviewCache()); assert.ok(Object.isFrozen(cache));
		assert.deepEqual(Object.keys(cache).sort(), ['load', 'store', 'trim']);
		assert.deepEqual(Object.keys(store.mediaRepository).sort(), originalPort);
		for (const method of ['saveDerivative', 'createBinaryDerivativeCache', 'assetRecord', 'beginAssetMaintenance']) assert.equal(Object.hasOwn(store.mediaRepository, method), false);
		await store.mediaRepository.writeAsset(source.photo.original.storageKey, source.original);
		const reference = [{ photoId: source.photo.id, assetId: source.photo.original.storageKey, sourceId: source.photo.original.id,
			sha256: source.photo.original.contentSha256, size: source.photo.original.byteLength }];
		await store.mediaRepository.catalogOriginals.retain(source.photo.catalogId, reference);
		await store.mediaRepository.catalogOriginals.stage(source.photo.catalogId, 'import-1', reference);
		await catalog.createCatalog({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog', id: source.photo.catalogId,
			name: 'Preview library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] });
		await catalog.publishPhotos(source.photo.catalogId, 0, [source.photo]);
		const originalRoots = await store.mediaRepository.catalogOriginals.readPage({ catalogId: source.photo.catalogId });
		const stagedRoots = await store.mediaRepository.catalogOriginals.readPage({ catalogId: source.photo.catalogId, importId: 'import-1' });
		assert.equal((await cache.store(value.prepared)).outcome, 'stored');
		assert.equal(current.indexedDB.recordCount(current.databaseName, 'videoDerivatives'), 1);
		assert.equal(current.indexedDB.recordCount(current.databaseName, 'videoDerivativeCacheEntries'), 1);
		assert.equal(current.indexedDB.recordCount(current.databaseName, 'mediaAssets'), 1);
		await store.close();
		await assert.rejects(cache.load(value.plan), /closed/u);
		const reopened = current.create();
		try {
			const cached = await reopened.getPreviewCache().load(value.plan); assert.ok(cached);
			assert.deepEqual(new Uint8Array(await cached.body.arrayBuffer()), Uint8Array.from([12, 34, 56, 255]));
			await reopened.getPreviewCache().trim();
			assert.deepEqual(await reopened.mediaRepository.catalogOriginals.readPage({ catalogId: source.photo.catalogId }), originalRoots);
			assert.deepEqual(await reopened.mediaRepository.catalogOriginals.readPage({ catalogId: source.photo.catalogId, importId: 'import-1' }), stagedRoots);
			assert.deepEqual(await catalog.loadPhoto(source.photo.catalogId, source.photo.id), source.photo);
			await assert.rejects(reopened.mediaRepository.deleteAsset(source.photo.original.storageKey), /catalog original/u);
			const original = await reopened.mediaRepository.loadAsset(source.photo.original.storageKey); assert.ok(original);
			assert.deepEqual(new Uint8Array(await original.arrayBuffer()), new Uint8Array([1, 2, 3]));
		} finally { await reopened.close(); }
		assert.equal(current.indexedDB.stats.getAllRequests.length, 0);
	} finally { await catalog.close(); await store.close(); }
});

test(`a paired cache request ${nativeModes.fault} rolls back both cache rows and retains exact original roots`, async () => {
	const current = fixture(), store = current.create(), source = photoArchiveFixture(), value = await preview();
	try {
		await store.mediaRepository.writeAsset(source.photo.original.storageKey, source.original);
		await store.mediaRepository.catalogOriginals.retain(source.photo.catalogId, [{ photoId: source.photo.id,
			assetId: source.photo.original.storageKey, sourceId: source.photo.original.id,
			sha256: source.photo.original.contentSha256, size: source.photo.original.byteLength }]);
		const roots = await store.mediaRepository.catalogOriginals.readPage({ catalogId: source.photo.catalogId });
		current.indexedDB.failNextPutForStore('videoDerivativeCacheEntries');
		await assert.rejects(store.getPreviewCache().store(value.prepared));
		assert.equal(current.indexedDB.recordCount(current.databaseName, 'videoDerivatives'), 0);
		assert.equal(current.indexedDB.recordCount(current.databaseName, 'videoDerivativeCacheEntries'), 0);
		assert.equal(await store.getPreviewCache().load(value.plan), null);
		assert.deepEqual(await store.mediaRepository.catalogOriginals.readPage({ catalogId: source.photo.catalogId }), roots);
		await store.verifyOriginal(source.photo.original);
	} finally { await store.close(); }
});

test('two repository instances share cache bodies while close permanently refuses each captured port', async () => {
	const current = fixture(), first = current.create(), second = current.create(), source = photoArchiveFixture(), value = await preview();
	try {
		await first.mediaRepository.writeAsset(source.photo.original.storageKey, source.original);
		const before = first.getPreviewCache();
		await before.store(value.prepared);
		assert.ok(await second.getPreviewCache().load(value.plan));
		await first.close(); await assert.rejects(before.store(value.prepared), /closed/u);
		assert.throws(() => first.getPreviewCache(), /closed/u);
		const next = second.getPreviewCache(); await next.store(value.prepared); assert.ok(await next.load(value.plan));
		await second.close(); await assert.rejects(next.trim(), /closed/u);
	} finally { await Promise.all([first.close(), second.close()]); }
});

test('terminal close cancels and joins an admitted cache transaction while retaining originals', async () => {
	const current = fixture(), store = current.create(), source = photoArchiveFixture(), value = await preview();
	await store.mediaRepository.writeAsset(source.photo.original.storageKey, source.original);
	const cache = store.getPreviewCache(); let closing: Promise<void> | undefined;
	current.indexedDB.onNextGetForStore('mediaAssets', () => { closing = store.close(); });
	await assert.rejects(cache.store(value.prepared), /closed|cancelled/u);
	assert.ok(closing); await closing;
	assert.equal(current.indexedDB.recordCount(current.databaseName, 'videoDerivatives'), 0);
	assert.equal(current.indexedDB.recordCount(current.databaseName, 'videoDerivativeCacheEntries'), 0);
	assert.equal(current.indexedDB.recordCount(current.databaseName, 'mediaAssets'), 1);
	const reopened = current.create();
	try { await reopened.verifyOriginal(source.photo.original); assert.equal(await reopened.getPreviewCache().load(value.plan), null); }
	finally { await reopened.close(); }
});
