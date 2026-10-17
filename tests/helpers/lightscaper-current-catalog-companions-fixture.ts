/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray } from '../../src/common/editor/closed-domain-value.ts';
import { openDatabase, readCursorPage, request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { normalizeCatalogOriginalRoot } from '../../src/common/editor/storage/media-catalog-original-schema.ts';
import type { StorageRecord } from '../../src/common/editor/storage/media-records.ts';
import { readBinaryDerivativeCacheRecordV1 } from '../../src/common/editor/storage/binary-derivative-cache-records.ts';
import { PhotoCatalogRepositoryV2 } from '../../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import { PHOTO_PREVIEW_CACHE_PROFILE_V1 } from '../../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import { PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';
import { readResidentPhotoLibraryCurrent } from './lightscaper-current-app-fixture.tsx';

/** Read only a complete tiny current library: full documents/bodies plus actual
 * selected stack, saved-state, custody and preview owners. Legacy witnesses stay fixed. */
export async function readCurrentCatalogCompanionsV1(value: readonly string[], indexedDB: IDBFactory = globalThis.indexedDB,
	beforeClose?: () => Promise<void>) {
	const ids = readClosedDomainArray(value, 'current companion photo IDs', 1, 4).map(value => {
		if (typeof value !== 'string' || !value || value.length > 256) throw TypeError('Current companion IDs must be bounded strings.');
		return value;
	});
	if (new Set(ids).size !== ids.length) throw RangeError('Current companion IDs must be distinct.');
	const anchor = new PhotoMediaStoreV1({ indexedDB });
	let media: PhotoMediaStoreV1 | null = null, catalog: PhotoCatalogRepositoryV2 | null = null, database: IDBDatabase | null = null;
	try {
		const ports = { settings: anchor.settingsRepository, async initializeDefault() { throw Error('Current companion observation cannot initialize a selected library.'); } };
		const selection = await readPhotoLibrarySessionLocationV2(ports), location = selection.location;
		const observed = await readResidentPhotoLibraryCurrent(ids, indexedDB, beforeClose), root = observed.root;
		if (!root || root.id !== location.catalogId || root.photoCount !== ids.length || observed.namespace !== location.namespaceToken) {
			throw Error('Current companions require the complete selected one-to-four-photo library.');
		}
		media = selection.allocation ? new PhotoMediaStoreV1({ indexedDB, databaseName: location.mediaDatabaseName, preferOpfs: false }) : anchor;
		const resources = await media.getCubeLutResources();
		catalog = new PhotoCatalogRepositoryV2({ indexedDB, databaseName: location.catalogDatabaseName,
			verifyOriginal: media.verifyOriginal, verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
		database = await openDatabase(indexedDB, location.mediaDatabaseName);
		const photos = [];
		for (const item of observed.photos) {
			const photo = item.photo;
			if (photo.original.byteLength > 1024 || item.bytes.length !== photo.original.byteLength) throw RangeError('Current companion original exceeds1KiB or has an incorrect body length.');
			const actualSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(item.bytes))), byte => byte.toString(16).padStart(2, '0')).join('');
			if (actualSha256 !== photo.original.contentSha256) throw Error('Current companion original body digest disagrees.');
			const authority = await transact(database, ['mediaAssets', 'catalogOriginalRoots'], 'readonly', async stores => {
				const row = await request<StorageRecord | undefined>(stores.mediaAssets.get(photo.original.storageKey));
				if (!row || row.sourceId !== photo.original.storageKey || row.sha256 !== actualSha256 || row.size !== item.bytes.length) throw Error('Current companion media identity disagrees.');
				const roots = await readCursorPage(stores.catalogOriginalRoots.index('assetId'), { query: photo.original.storageKey, limit: 5,
					project: (value, key) => {
						const current = normalizeCatalogOriginalRoot(value);
						if (current.key !== key || current.catalogId !== root.id || current.importId !== null
							|| current.mediaContentToken !== row.mediaContentToken) throw Error('Current companion custody identity disagrees.');
						return current;
					} });
				const expected = observed.photos.filter(item => item.photo.original.storageKey === photo.original.storageKey);
				if (roots.length !== expected.length || row.catalogRootCount !== roots.length || expected.some(item => !roots.some(current =>
					current.photoId === item.photo.id && current.sourceId === item.photo.original.id && current.sha256 === item.photo.original.contentSha256
					&& current.size === item.photo.original.byteLength))) throw Error('Current companion committed custody is incomplete.');
				return { sourceId: row.sourceId, storage: row.storage, size: row.size, sha256: row.sha256,
					mediaContentToken: row.mediaContentToken, catalogRootCount: row.catalogRootCount, roots };
			});
			photos.push({ ...item, authority, actualSha256 });
		}
		const stackState = await catalog.readStackState(root.id);
		if (stackState.stackCount > 2) throw RangeError('Current companion observation exceeds two stacks.');
		const stackPage = await catalog.readStackPage(root.id), stacks = [];
		if (stackPage.continuation || stackPage.items.length !== stackState.stackCount) throw Error('Current companion stack inventory disagrees.');
		for (const summary of stackPage.items) {
			const stack = await catalog.loadStack(root.id, summary.id);
			if (!stack || stack.photoIds.length > 4 || stack.photoIds.some(id => !ids.includes(id))) throw Error('Current companion stack escapes the selected photos.');
			stacks.push(stack);
		}
		const context = await catalog.readSmartCollectionArchiveContextV1(root.id), saved = [];
		if ((context.state?.collectionCount ?? 0) > 2) throw RangeError('Current companion observation exceeds two saved definitions.');
		const savedPage = await catalog.readSmartCollectionPage(root.id);
		if (savedPage.continuation || savedPage.items.length !== (context.state?.collectionCount ?? 0)) throw Error('Current companion saved inventory disagrees.');
		for (const summary of savedPage.items) {
			const definition = await catalog.loadSmartCollection(root.id, summary.id);
			if (!definition) throw Error('Current companion saved definition disappeared.'); saved.push(definition);
		}
		const previews = await transact(database, 'videoDerivativeCacheEntries', 'readonly', async stores =>
			readCursorPage(stores.videoDerivativeCacheEntries, { limit: 17, project: (value, key) => {
				if (typeof key !== 'string') throw Error('Current companion preview key is malformed.');
				const row = readBinaryDerivativeCacheRecordV1(value, key, PHOTO_PREVIEW_CACHE_PROFILE_V1);
				if (!observed.photos.some(item => item.photo.original.storageKey === row.sourceId)) throw Error('Current companion preview escapes selected originals.');
				return { key: row.key, sourceId: row.sourceId, size: row.size, outputSha256: row.outputSha256 };
			} }));
		if (previews.length > 16) throw RangeError('Current companion preview inventory exceeds16entries.');
		if (JSON.stringify(await readPhotoLibrarySessionLocationV2(ports)) !== JSON.stringify(selection)
			|| JSON.stringify(await catalog.loadCatalog(root.id)) !== JSON.stringify(root)) throw Error('Current companion selected namespace or root changed.');
		const output = { root, namespace: location.namespaceToken, photos, stackState, stacks, savedState: context.state, saved, previews };
		if (new TextEncoder().encode(JSON.stringify(output)).byteLength > 80 * 1024) throw RangeError('Current companion observation exceeds80KiB.');
		await beforeClose?.(); return output;
	} finally { database?.close(); await Promise.all([catalog?.close(), media?.close(), anchor.close()]); }
}
