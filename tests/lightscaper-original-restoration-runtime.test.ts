/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaRepository } from '../src/common/editor/storage/media-repository.ts';
import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { PhotoCatalogRepositoryV1 } from '../src/lightscaper/catalog/repository.ts';
import { normalizePhotoCatalogRootV1 } from '../src/lightscaper/catalog/catalog-root.ts';
import { createPhotoLibrarySessionV1 } from '../src/lightscaper/photo-library-session-runtime.ts';
import { PHOTO_MEDIA_NAMESPACES_V1, PhotoMediaStoreV1 } from '../src/lightscaper/storage/photo-media-store.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { MemoryLockManager } from './helpers/offline-browser-runtime-store-fixture.ts';
import { photoArchiveFixture } from './helpers/lightscaper-photo-fixture.ts';

test('default runtime uses bound strict inspection and exact restoration adapters while preserving the original identity', async context => {
	const backing = createInstrumentedIndexedDB(), indexedDB = backing as unknown as IDBFactory;
	const priorDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB'), priorNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true });
	Object.defineProperty(globalThis, 'navigator', { value: { locks: new MemoryLockManager() }, configurable: true });
	context.after(() => {
		if (priorDb) Object.defineProperty(globalThis, 'indexedDB', priorDb); else Reflect.deleteProperty(globalThis, 'indexedDB');
		if (priorNavigator) Object.defineProperty(globalThis, 'navigator', priorNavigator); else Reflect.deleteProperty(globalThis, 'navigator');
	});
	const source = photoArchiveFixture(), media = new PhotoMediaStoreV1(), catalog = new PhotoCatalogRepositoryV1({ indexedDB, verifyOriginal: media.verifyOriginal });
	await media.mediaRepository.writeAsset(source.photo.original.storageKey, source.original, { name: source.photo.original.name, mimeType: source.photo.original.mimeType });
	await media.mediaRepository.catalogOriginals.retain('catalog-1', [{ photoId: source.photo.id, assetId: source.photo.original.storageKey,
		sourceId: source.photo.original.id, sha256: source.photo.original.contentSha256, size: source.original.size }]);
	await catalog.createCatalog(normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog-1', name: 'Runtime recovery', revision: 0, photoCount: 0, folders: [], keywords: [], collections: [] }));
	await catalog.publishPhotos('catalog-1', 0, [source.photo]);
	await media.settingsRepository.putIfAbsent(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1, { schemaVersion: 1, kind: 'photo-library', catalogId: 'catalog-1' });
	const database = await openDatabase(indexedDB, PHOTO_MEDIA_NAMESPACES_V1.databaseName);
	await transact(database, 'mediaAssets', 'readwrite', ({ mediaAssets }) => request(mediaAssets.delete(source.photo.original.storageKey)));
	const roots = backing.records(PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'catalogOriginalRoots');
	await catalog.close(); await media.close();
	const inspect = MediaRepository.prototype.inspectCatalogOriginalBody, restore = MediaRepository.prototype.restoreCatalogOriginalBody;
	const calls: string[] = [];
	MediaRepository.prototype.inspectCatalogOriginalBody = function (binding, options = {}) {
		assert.ok(this instanceof MediaRepository); assert.ok(options.signal instanceof AbortSignal); calls.push('inspect'); return inspect.call(this, binding, options);
	};
	MediaRepository.prototype.restoreCatalogOriginalBody = function (binding, selected, options = {}) {
		assert.ok(this instanceof MediaRepository); assert.ok(options.signal instanceof AbortSignal); assert.equal(selected, source.original);
		calls.push('restore'); return restore.call(this, binding, selected, options);
	};
	const session = createPhotoLibrarySessionV1({ name: 'Fallback' });
	try {
		const page = await session.inspectOriginals(), row = page.rows[0]; assert.ok(row);
		assert.deepEqual(row.inspection, { status: 'missing', reason: 'media-row' });
		const result = await session.restoreOriginalBody({ schemaVersion: 1, catalogRevision: page.revision,
			activeImportId: page.activeImportId, photoRevision: row.revision, binding: row.binding }, source.original);
		assert.deepEqual(result, { photoId: 'photo-1', assetId: 'original-1', sha256: row.binding.sha256, size: 3, notices: [] });
		assert.equal((await session.inspectOriginals()).rows[0]?.inspection.status, 'present');
		assert.deepEqual(calls, ['inspect', 'restore', 'inspect']);
		assert.deepEqual(backing.records(PHOTO_MEDIA_NAMESPACES_V1.databaseName, 'catalogOriginalRoots'), roots);
		assert.equal((await session.readPage()).catalogName, 'Runtime recovery');
	} finally {
		MediaRepository.prototype.inspectCatalogOriginalBody = inspect; MediaRepository.prototype.restoreCatalogOriginalBody = restore;
		await session.close(); database.close();
	}
});

test('narrow media facade methods preserve delegated options and genuine receiver after extraction', async () => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	const media = new PhotoMediaStoreV1({ indexedDB, databaseName: `lightscaper-recovery-adapters-${crypto.randomUUID()}`, locks: null, preferOpfs: false });
	const source = photoArchiveFixture(), original = source.photo.original;
	await media.mediaRepository.writeAsset(original.storageKey, source.original);
	await media.mediaRepository.catalogOriginals.retain('catalog-1', [{ photoId: source.photo.id, assetId: original.storageKey,
		sourceId: original.id, sha256: original.contentSha256, size: original.byteLength }]);
	const binding = { catalogId: 'catalog-1', importId: null, photoId: source.photo.id, assetId: original.storageKey,
		sourceId: original.id, sha256: original.contentSha256, size: original.byteLength, name: original.name, mimeType: original.mimeType };
	const inspection = media.mediaRepository.inspectCatalogOriginalBody, restoration = media.mediaRepository.restoreCatalogOriginalBody;
	const options = { signal: new AbortController().signal }, inspect = MediaRepository.prototype.inspectCatalogOriginalBody, restore = MediaRepository.prototype.restoreCatalogOriginalBody;
	MediaRepository.prototype.inspectCatalogOriginalBody = function (admitted, supplied) { assert.equal(supplied, options); return inspect.call(this, admitted, supplied); };
	MediaRepository.prototype.restoreCatalogOriginalBody = function (admitted, selected, supplied) { assert.equal(supplied, options); return restore.call(this, admitted, selected, supplied); };
	try {
		assert.deepEqual(await inspection(binding, options), { status: 'present' });
		assert.deepEqual(await restoration(binding, source.original, options), { assetId: binding.assetId, sha256: binding.sha256, size: binding.size });
	} finally {
		MediaRepository.prototype.inspectCatalogOriginalBody = inspect; MediaRepository.prototype.restoreCatalogOriginalBody = restore; await media.close();
	}
});
