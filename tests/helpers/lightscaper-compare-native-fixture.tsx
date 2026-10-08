/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField, readClosedDomainRecord } from '../../src/common/editor/closed-domain-value.ts';
import { readBinaryDerivativeCacheRecordV1 } from '../../src/common/editor/storage/binary-derivative-cache-records.ts';
import { openDatabase, readCursorPage, request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { normalizeCatalogOriginalRoot } from '../../src/common/editor/storage/media-catalog-original-schema.ts';
import type { StorageRecord } from '../../src/common/editor/storage/media-records.ts';
import { MediaRepository } from '../../src/common/editor/storage/media-repository.ts';
import { getMemoryDatabase } from '../../src/common/editor/storage/memory-backend.ts';
import { OpfsRepository } from '../../src/common/editor/storage/opfs-repository.ts';
import { PhotoCatalogRepositoryV1 } from '../../src/lightscaper/catalog/repository.ts';
import { PHOTO_PREVIEW_CACHE_PROFILE_V1 } from '../../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from '../../src/lightscaper/storage/photo-library-catalog-pointer.ts';
import { PHOTO_MEDIA_NAMESPACES_V1, PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';

export { bundledLightscaperEditorCopyForLocale as compareCopyForLocaleV1 } from '../../src/common/i18n/lightscaper-editor-copy.ts';

/** Observe four actual UI-imported rows, tiny retained sources and native custody. */
export async function observeCompareLibraryV1(photoIds: readonly string[]) {
	if (photoIds.length !== 4 || new Set(photoIds).size !== 4 || photoIds.some(id => typeof id !== 'string' || !id || id.length > 256)) {
		throw new RangeError('Compare qualification observes exactly four explicit photos.');
	}
	const media = new PhotoMediaStoreV1(), catalog = new PhotoCatalogRepositoryV1({ indexedDB, verifyOriginal: media.verifyOriginal });
	let database: IDBDatabase | null = null;
	try {
		await media.ready();
		const pointer = readClosedDomainRecord(await media.settingsRepository.get(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1),
			'Compare library pointer', ['schemaVersion', 'kind', 'catalogId']);
		const catalogId = readClosedDomainField(pointer, 'catalogId', 'Compare library pointer');
		if (typeof catalogId !== 'string') throw new TypeError('Compare library pointer has no catalog identity.');
		const root = await catalog.loadCatalog(catalogId);
		if (!root || root.photoCount !== 4) throw new Error('Compare qualification requires four published photos.');
		database = await openDatabase(indexedDB, PHOTO_MEDIA_NAMESPACES_V1.databaseName);
		const photos = [];
		for (const photoId of photoIds) {
			const photo = await catalog.loadPhoto(root.id, photoId);
			if (!photo || photo.original.byteLength > 1024) throw new Error('Compare original is missing or exceeds1KiB.');
			await media.verifyOriginal(photo.original);
			const body = await media.mediaRepository.loadAsset(photo.original.storageKey, { expectedSize: photo.original.byteLength });
			if (!(body instanceof Blob)) throw new Error('Compare original body is unavailable.');
			const buffer = await body.arrayBuffer();
			const authority = await transact(database, ['mediaAssets', 'catalogOriginalRoots'], 'readonly', async stores => {
				const row = await request<StorageRecord | undefined>(stores.mediaAssets.get(photo.original.storageKey));
				if (!row) throw new Error('Compare original media row is missing.');
				const roots = await readCursorPage(stores.catalogOriginalRoots.index('assetId'), { query: photo.original.storageKey,
					limit: 8, project: (value, key) => {
						const current = normalizeCatalogOriginalRoot(value);
						if (current.key !== key || current.catalogId !== catalogId) throw new Error('Compare custody identity disagrees.');
						return current;
					} });
				if (roots.length !== 1 || roots[0]?.photoId !== photoId || roots[0].importId !== null) throw new Error('Compare custody must remain committed and distinct.');
				return { sourceId: row.sourceId, storage: row.storage, size: row.size, sha256: row.sha256,
					mediaContentToken: row.mediaContentToken, catalogRootCount: row.catalogRootCount, roots };
			});
			photos.push({ id: photo.id, revision: photo.revision, fileName: photo.metadata.fileName,
				rating: photo.rating, flag: photo.flag, colorLabel: photo.colorLabel, original: photo.original,
				authority, actualSha256: await digest(buffer), bytes: Array.from(new Uint8Array(buffer)) });
		}
		const previews = await transact(database, 'videoDerivativeCacheEntries', 'readonly', async stores =>
			readCursorPage(stores.videoDerivativeCacheEntries, { limit: 16, project: (value, key) => {
				if (typeof key !== 'string') throw new Error('Compare cache primary key is malformed.');
				const preview = readBinaryDerivativeCacheRecordV1(value, key, PHOTO_PREVIEW_CACHE_PROFILE_V1);
				return { key: preview.key, sourceId: preview.sourceId, size: preview.size, outputSha256: preview.outputSha256 };
			} }));
		const output = { catalogId: root.id, rootRevision: root.revision, totalCount: root.photoCount, photos, previews };
		if (new TextEncoder().encode(JSON.stringify(output)).byteLength > 64 * 1024) throw new RangeError('Compare scalar observation exceeds64KiB.');
		return output;
	} finally { database?.close(); await Promise.all([catalog.close(), media.close()]); }
}

/** Exercise the real paired-cache eviction owner with an explicit zero-capacity pressure profile. */
export async function evictComparePreviewsV1() {
	const database = await openDatabase(indexedDB, PHOTO_MEDIA_NAMESPACES_V1.databaseName);
	const opfs = new OpfsRepository({ preferOpfs: true, opfsDirectoryName: PHOTO_MEDIA_NAMESPACES_V1.opfsDirectoryName,
		opfsWorkerName: PHOTO_MEDIA_NAMESPACES_V1.opfsWorkerName });
	const media = new MediaRepository({ memory: getMemoryDatabase(PHOTO_MEDIA_NAMESPACES_V1.databaseName), database: () => Promise.resolve(database) }, opfs);
	try {
		const cache = media.createBinaryDerivativeCache({ ...PHOTO_PREVIEW_CACHE_PROFILE_V1, maximumBytes: 0, maximumEntries: 0 });
		const receipt = await cache.trim();
		if (receipt.more || receipt.cleanupErrors?.length) throw new Error('Compare preview eviction did not settle cleanly.');
		return { removedEntries: receipt.removedEntries, removedBytes: receipt.removedBytes };
	} finally {
		const maintenance = media.beginAssetMaintenance({ permanent: true });
		try { await maintenance.abortActive(); }
		finally { maintenance.release(); opfs.close(); database.close(); }
	}
}

async function digest(buffer: ArrayBuffer): Promise<string> {
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export type CompareLibraryObservationV1 = Awaited<ReturnType<typeof observeCompareLibraryV1>>;
