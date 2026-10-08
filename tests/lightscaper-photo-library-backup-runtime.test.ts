/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoLibraryBackupPortV1 } from '../src/common/editor/photo-library-backup-port-v1.ts';
import { createPhotoLibrarySessionV1 } from '../src/lightscaper/photo-library-session-runtime.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { MediaRepository } from '../src/common/editor/storage/media-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { MemoryLockManager } from './helpers/offline-browser-runtime-store-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

async function fixture() {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const previousDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB'), previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true });
	Object.defineProperty(globalThis, 'navigator', { value: { locks: new MemoryLockManager() }, configurable: true });
	const media = new PhotoMediaStoreV1(), catalog = new PhotoCatalogRepositoryV1({ indexedDB, verifyOriginal: media.verifyOriginal });
	const source = photoArchiveFixture();
	await media.mediaRepository.writeAsset(source.photo.original.storageKey, source.original);
	await media.mediaRepository.catalogOriginals.retain('catalog-1', [{ photoId: source.photo.id, sourceId: source.photo.original.id,
		assetId: source.photo.original.storageKey, sha256: source.photo.original.contentSha256, size: source.original.size }]);
	await catalog.createCatalog(normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Existing runtime library', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] }));
	await catalog.publishPhotos('catalog-1', 0, [source.photo]);
	await media.settingsRepository.putIfAbsent(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1, { schemaVersion: 1, kind: 'photo-library', catalogId: 'catalog-1' });
	await Promise.all([catalog.close(), media.close()]);
	const session: ReturnType<typeof createPhotoLibrarySessionV1> & PhotoLibraryBackupPortV1 = createPhotoLibrarySessionV1({ name: 'Fallback library' });
	return { session, source, restore: () => {
		if (previousDb) Object.defineProperty(globalThis, 'indexedDB', previousDb); else Reflect.deleteProperty(globalThis, 'indexedDB');
		if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
	} };
}

test('default runtime authenticates the immutable original before passing its exact size to the same-record media loader', async () => {
	const f = await fixture(), events: string[] = [];
	const metadata = MediaRepository.prototype.getAssetMetadata, load = MediaRepository.prototype.loadAsset;
	MediaRepository.prototype.getAssetMetadata = async function (key) { events.push(`verify:${key}`); return metadata.call(this, key); };
	MediaRepository.prototype.loadAsset = function (key, options = {}) {
		events.push(`load:${key}`); assert.equal(options.expectedSize, f.source.original.size);
		assert.ok(options.signal instanceof AbortSignal); return load.call(this, key, options);
	};
	try {
		const output = await f.session.backupCatalog(); assert.ok(output.blob);
		assert.equal(output.catalogName, 'Existing runtime library'); assert.equal(output.photoCount, 1);
		assert.deepEqual(events, ['verify:original-1', 'load:original-1']);
	} finally {
		MediaRepository.prototype.getAssetMetadata = metadata; MediaRepository.prototype.loadAsset = load;
		await f.session.close(); f.restore();
	}
});

test('default runtime refuses a changed custody digest before opening any original body', async () => {
	const f = await fixture(); let loads = 0;
	const metadata = MediaRepository.prototype.getAssetMetadata, load = MediaRepository.prototype.loadAsset;
	MediaRepository.prototype.getAssetMetadata = async function (key) {
		const value = await metadata.call(this, key); return value ? { ...value, sha256: 'f'.repeat(64) } : null;
	};
	MediaRepository.prototype.loadAsset = function (...args) { loads++; return load.apply(this, args); };
	try { await assert.rejects(f.session.backupCatalog(), error => contains(error, /media identity/iu)); assert.equal(loads, 0); }
	finally {
		MediaRepository.prototype.getAssetMetadata = metadata; MediaRepository.prototype.loadAsset = load;
		await f.session.close(); f.restore();
	}
});

function contains(value: unknown, pattern: RegExp): boolean {
	return value instanceof Error && (pattern.test(value.message) || (value instanceof AggregateError && value.errors.some(error => contains(error, pattern))));
}
