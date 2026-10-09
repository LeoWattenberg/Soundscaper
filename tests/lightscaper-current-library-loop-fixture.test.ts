/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { corruptCurrentLibraryOriginalV1, evictCurrentLibraryPreviewsV1, readCurrentLibraryPreviewInventoryV1 } from './helpers/lightscaper-current-library-loop-fixture.ts';
import { createPhotoLibraryRestoreRuntimeV2 } from '../src/lightscaper/photo-library-restore-runtime-v2.ts';
import { exportPhotoCatalogArchiveV5 } from '../src/lightscaper/archive/catalog-archive-export-v5.ts';
import { PhotoCatalogRepositoryV2 } from '../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { PhotoMediaStoreV1, PHOTO_MEDIA_NAMESPACES_V1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { readPhotoLibrarySessionLocationV2 } from '../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { preparePhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';
import { planPhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { mediaRestoreFixture } from './helpers/lightscaper-media-restore-fixture.ts';
import { lutArchiveFixture, LUT_BODY } from './helpers/lightscaper-lut-archive-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';
import { InstrumentedKeyRange } from './helpers/instrumented-indexeddb-keys.ts';
import { MemoryLockManager } from './helpers/offline-browser-runtime-store-fixture.ts';

const previous = Object.getOwnPropertyDescriptor(globalThis, 'IDBKeyRange');
Object.defineProperty(globalThis, 'IDBKeyRange', { configurable: true, value: InstrumentedKeyRange });
after(() => { if (previous) Object.defineProperty(globalThis, 'IDBKeyRange', previous); else Reflect.deleteProperty(globalThis, 'IDBKeyRange'); });
const IDS = ['photo-1', 'photo-2'];

async function restored() {
	const f = mediaRestoreFixture(), current = lutArchiveFixture(), legacy = photoArchiveFixture(2);
	const source = await exportPhotoCatalogArchiveV5({ ...current.root, photoCount: 2 }, [current.record, legacy], [], null, [], null,
		{ async withBytes(_reference, consume) { return consume(LUT_BODY); } });
	assert.ok(source.blob);
	const runtime = createPhotoLibraryRestoreRuntimeV2({ name: 'Connected loop', indexedDB: f.factory, locks: new MemoryLockManager() as unknown as LockManager });
	try { assert.equal((await runtime.restoreArchive(source.blob)).photoCount, 2); } finally { await runtime.close(); }
	const anchor = new PhotoMediaStoreV1({ indexedDB: f.factory, preferOpfs: false, locks: null });
	const selected = await readPhotoLibrarySessionLocationV2({ settings: anchor.settingsRepository,
		async initializeDefault() { throw Error('No fixture initialization'); } });
	const media = new PhotoMediaStoreV1({ indexedDB: f.factory, databaseName: selected.location.mediaDatabaseName, preferOpfs: false, locks: null });
	const resources = await media.getCubeLutResources();
	const catalog = new PhotoCatalogRepositoryV2({ indexedDB: f.factory, databaseName: selected.location.catalogDatabaseName,
		verifyOriginal: media.verifyOriginal, verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
	return { f, current, legacy, selected, anchor, media, catalog,
		async close() { await Promise.all([catalog.close(), media.close(), anchor.close()]); } };
}

test('the current loop helper refuses unbounded IDs and never initializes an absent selected library', async () => {
	const f = mediaRestoreFixture();
	for (const ids of [[], ['photo'], ['same', 'same'], ['a', 'b', 'c']]) await assert.rejects(corruptCurrentLibraryOriginalV1(ids, f.factory));
	assert.deepEqual(f.opens, []);
	await assert.rejects(evictCurrentLibraryPreviewsV1(IDS, f.factory), /selected library/u);
	assert.equal(f.raw(PHOTO_MEDIA_NAMESPACES_V1.databaseName).recordCount(PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'settings'), 0);
});

test('the bounded fault changes only a committed selected original body, preserving mixed documents, roots, LUTs and the default namespace', async () => {
	const x = await restored(), name = x.selected.location.mediaDatabaseName, key = x.current.record.photo.original.storageKey;
	try {
		await x.anchor.mediaRepository.writeAsset(key, new Blob([new Uint8Array([9, 8, 7])]));
		const defaultRows = x.f.raw(PHOTO_MEDIA_NAMESPACES_V1.databaseName).records(PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'mediaAssets');
		const photos = await Promise.all(IDS.map(id => x.catalog.loadPhoto('catalog-1', id)));
		assert.deepEqual(photos.map(photo => photo?.schemaVersion), [2, 1]);
		const roots = x.f.raw(name).records(name, 'catalogOriginalRoots'), luts = x.f.raw(name).records(name, 'analysis');
		const before = x.f.raw(name).records(name, 'mediaAssets').find(row => row.sourceId === key); assert.ok(before);
		const receipt = await corruptCurrentLibraryOriginalV1(IDS, x.f.factory);
		assert.equal(receipt.namespace, x.selected.location.namespaceToken); assert.equal(receipt.storageKey, key);
		assert.equal(receipt.expectedSha256, x.current.record.photo.original.contentSha256); assert.notEqual(receipt.corruptSha256, receipt.expectedSha256);
		assert.deepEqual(await Promise.all(IDS.map(id => x.catalog.loadPhoto('catalog-1', id))), photos);
		assert.deepEqual(x.f.raw(name).records(name, 'catalogOriginalRoots'), roots); assert.deepEqual(x.f.raw(name).records(name, 'analysis'), luts);
		assert.deepEqual(x.f.raw(PHOTO_MEDIA_NAMESPACES_V1.databaseName).records(PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'mediaAssets'), defaultRows);
		const after = x.f.raw(name).records(name, 'mediaAssets').find(row => row.sourceId === key); assert.ok(after);
		for (const field of ['sourceId', 'size', 'sha256', 'mediaContentToken', 'catalogRootCount']) assert.equal(after[field], before[field]);
		const body = await x.media.mediaRepository.loadAsset(key); assert.ok(body); assert.deepEqual([...new Uint8Array(await body.arrayBuffer())], [1, 2, 2]);
		// Metadata remains valid while the explicitly corrupted body fails owning inspection.
		await x.media.verifyOriginal(x.current.record.photo.original);
		const photo = x.current.record.photo;
		const report = await x.media.mediaRepository.inspectCatalogOriginalBody({ catalogId: photo.catalogId, importId: null,
			photoId: photo.id, assetId: key, sourceId: photo.original.id, sha256: photo.original.contentSha256,
			size: photo.original.byteLength, name: photo.original.name, mimeType: photo.original.mimeType });
		assert.equal(report.status, 'corrupt');
	} finally { await x.close(); }
});

test('paired preview eviction selects the committed restore namespace and preserves exact original/custody/resource/document ledgers', async () => {
	const x = await restored(), name = x.selected.location.mediaDatabaseName;
	try {
		for (const photo of [x.current.record.photo, x.legacy.photo]) {
			const binding = { catalogId: photo.catalogId, photoId: photo.id, originalId: photo.original.id, storageKey: photo.original.storageKey,
				contentSha256: photo.original.contentSha256, byteLength: photo.original.byteLength, width: 1, height: 1 };
			const frame = { descriptor: { schemaVersion: 1, width: 1, height: 1, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' },
				pixels: Uint8Array.from([12, 34, 56, 255]) };
			for (const tier of ['thumbnail', 'fit-screen']) {
				const plan = planPhotoPreviewV1({ binding, source: frame.descriptor, tier });
				assert.equal((await x.media.getPreviewCache().store(await preparePhotoPreviewV1({ plan, binding, frame }))).outcome, 'stored');
			}
		}
		const priorGetAll = x.f.raw(name).stats.getAllRequests.length;
		const inventory = await readCurrentLibraryPreviewInventoryV1(IDS, x.f.factory); assert.equal(inventory.entries.length, 4);
		const ledgers = ['mediaAssets', 'catalogOriginalRoots', 'analysis'].map(store => x.f.raw(name).records(name, store));
		const photos = await Promise.all(IDS.map(id => x.catalog.loadPhoto('catalog-1', id)));
		assert.deepEqual(await evictCurrentLibraryPreviewsV1(IDS, x.f.factory), { namespace: x.selected.location.namespaceToken, removedEntries: 4, removedBytes: 16 });
		assert.deepEqual((await readCurrentLibraryPreviewInventoryV1(IDS, x.f.factory)).entries, []);
		assert.equal(x.f.raw(name).recordCount(name, 'videoDerivatives'), 0); assert.equal(x.f.raw(name).recordCount(name, 'videoDerivativeCacheEntries'), 0);
		assert.deepEqual(['mediaAssets', 'catalogOriginalRoots', 'analysis'].map(store => x.f.raw(name).records(name, store)), ledgers);
		assert.deepEqual(await Promise.all(IDS.map(id => x.catalog.loadPhoto('catalog-1', id))), photos);
		for (const photo of [x.current.record.photo, x.legacy.photo]) {
			const body = await x.media.mediaRepository.loadAsset(photo.original.storageKey); assert.ok(body instanceof Blob);
			assert.deepEqual([...new Uint8Array(await body.arrayBuffer())], [1, 2, 3]);
		}
		assert.equal(x.f.raw(name).stats.getAllRequests.length, priorGetAll);
	} finally { await x.close(); }
});

test('a pointer to an uncommitted namespace is refused before opening or mutating that target', async () => {
	const f = mediaRestoreFixture(), anchor = new PhotoMediaStoreV1({ indexedDB: f.factory, locks: null, preferOpfs: false });
	try {
		await anchor.settingsRepository.put(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1, { schemaVersion: 2, kind: 'photo-library', catalogId: 'catalog-1', namespaceToken: 'f'.repeat(32) });
		const count = f.opens.length;
		await assert.rejects(corruptCurrentLibraryOriginalV1(IDS, f.factory));
		assert.equal(f.opens.slice(count).some(open => open.name.includes('-restore-')), false);
	} finally { await anchor.close(); }
});
