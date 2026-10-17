/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray } from '../../src/common/editor/closed-domain-value.ts';
import { readBinaryDerivativeCacheRecordV1 } from '../../src/common/editor/storage/binary-derivative-cache-records.ts';
import { openDatabase, readCursorPage, request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { normalizeCatalogOriginalRoot } from '../../src/common/editor/storage/media-catalog-original-schema.ts';
import type { StorageRecord } from '../../src/common/editor/storage/media-records.ts';
import { MediaRepository } from '../../src/common/editor/storage/media-repository.ts';
import { getMemoryDatabase } from '../../src/common/editor/storage/memory-backend.ts';
import { OpfsRepository } from '../../src/common/editor/storage/opfs-repository.ts';
import { PhotoCatalogRepositoryV2 } from '../../src/lightscaper/catalog/photo-catalog-repository-v2.ts';
import type { PhotoDocumentV1 } from '../../src/lightscaper/catalog/types.ts';
import type { PhotoDocumentV2 } from '../../src/lightscaper/catalog/photo-document-v2.ts';
import { PHOTO_PREVIEW_CACHE_PROFILE_V1 } from '../../src/lightscaper/preview/photo-preview-cache-v1.ts';
import { readPhotoLibrarySessionLocationV2 } from '../../src/lightscaper/storage/photo-library-location-reader-v2.ts';
import type { PhotoLibraryLocationV2 } from '../../src/lightscaper/storage/photo-library-location-v2.ts';
import { PHOTO_MEDIA_NAMESPACES_V1, PhotoMediaStoreV1 } from '../../src/lightscaper/storage/photo-media-store.ts';

interface Selected {
	readonly location: Readonly<PhotoLibraryLocationV2>;
	readonly media: PhotoMediaStoreV1;
	readonly database: IDBDatabase;
	readonly photos: readonly (PhotoDocumentV1 | PhotoDocumentV2)[];
}

/** Explicit test fault: one <=1KiB body becomes temporarily unverifiable.
 * No document, original identity, custody root, LUT, pointer or commit is authored. */
export async function corruptCurrentLibraryOriginalV1(photoIds: readonly string[], indexedDB = globalThis.indexedDB) {
	return withSelected(photoIds, indexedDB, async selected => {
		const photo = selected.photos[0]!;
		const original = await selected.media.mediaRepository.loadAsset(photo.original.storageKey);
		if (!(original instanceof Blob) || original.size !== photo.original.byteLength) throw Error('Loop original body is unavailable.');
		const bytes = new Uint8Array(await original.arrayBuffer());
		try {
			if (await digest(bytes) !== photo.original.contentSha256) throw Error('Loop fault requires an authenticated original body.');
			bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
			const corruptSha256 = await digest(bytes);
			await transact(selected.database, ['mediaAssets', 'catalogOriginalRoots'], 'readwrite', async stores => {
				const row = await request<StorageRecord | undefined>(stores.mediaAssets.get(photo.original.storageKey));
				if (!row || row.sourceId !== photo.original.storageKey || row.sha256 !== photo.original.contentSha256
					|| row.size !== photo.original.byteLength) throw Error('Loop fault source identity changed.');
				const roots = await readCursorPage(stores.catalogOriginalRoots.index('assetId'), { query: photo.original.storageKey, limit: 3,
					project: (value, key) => {
						const root = normalizeCatalogOriginalRoot(value);
						if (root.key !== key || root.catalogId !== photo.catalogId || root.importId !== null
							|| !selected.photos.some(item => item.id === root.photoId)) throw Error('Loop fault custody escaped the selected photos.');
						return root;
					} });
				if (roots.length < 1 || roots.length > 2 || !roots.some(root => root.photoId === photo.id)
					|| row.catalogRootCount !== roots.length) throw Error('Loop fault requires complete committed custody.');
				const replacement: Record<string, unknown> = { ...row, storage: 'indexeddb-blob', blob: new Blob([bytes], { type: photo.original.mimeType }) };
				for (const key of ['path', 'mediaChunkToken', 'mediaChunkBytes', 'mediaChunkCount']) delete replacement[key];
				await request(stores.mediaAssets.put(replacement));
			});
			return { namespace: selected.location.namespaceToken, storageKey: photo.original.storageKey,
				expectedSha256: photo.original.contentSha256, corruptSha256 };
		} finally { bytes.fill(0); }
	});
}

export async function readCurrentLibraryPreviewInventoryV1(photoIds: readonly string[], indexedDB = globalThis.indexedDB) {
	return withSelected(photoIds, indexedDB, async selected => ({ namespace: selected.location.namespaceToken, entries: await previews(selected) }));
}

/** Invoke the real paired-cache owner with an explicit zero-capacity pressure profile. */
export async function evictCurrentLibraryPreviewsV1(photoIds: readonly string[], indexedDB = globalThis.indexedDB) {
	return withSelected(photoIds, indexedDB, async selected => {
		await previews(selected); // Bound and authenticate the tiny fixture inventory before mutation.
		const opfs = new OpfsRepository({ preferOpfs: selected.location.namespaceToken === null,
			opfsDirectoryName: PHOTO_MEDIA_NAMESPACES_V1.opfsDirectoryName, opfsWorkerName: PHOTO_MEDIA_NAMESPACES_V1.opfsWorkerName });
		const media = new MediaRepository({ memory: getMemoryDatabase(selected.location.mediaDatabaseName), database: () => Promise.resolve(selected.database) }, opfs);
		try {
			const receipt = await media.createBinaryDerivativeCache({ ...PHOTO_PREVIEW_CACHE_PROFILE_V1, maximumBytes: 0, maximumEntries: 0 }).trim();
			if (receipt.more || receipt.cleanupErrors?.length) throw Error('Loop preview eviction did not settle cleanly.');
			return { namespace: selected.location.namespaceToken, removedEntries: receipt.removedEntries, removedBytes: receipt.removedBytes };
		} finally {
			const maintenance = media.beginAssetMaintenance({ permanent: true });
			try { await maintenance.abortActive(); } finally { maintenance.release(); opfs.close(); }
		}
	});
}

async function previews(selected: Selected) {
	const prefix = PHOTO_PREVIEW_CACHE_PROFILE_V1.keyPrefix;
	return transact(selected.database, 'videoDerivativeCacheEntries', 'readonly', async stores => {
		const entries = await readCursorPage(stores.videoDerivativeCacheEntries, { query: IDBKeyRange.bound(prefix, `${prefix}\uffff`), limit: 17,
			project: (value, key) => {
				if (typeof key !== 'string') throw Error('Loop preview key is malformed.');
				const row = readBinaryDerivativeCacheRecordV1(value, key, PHOTO_PREVIEW_CACHE_PROFILE_V1);
				if (!selected.photos.some(photo => photo.original.storageKey === row.sourceId)) throw Error('Loop preview belongs to an unselected source.');
				return { key: row.key, sourceId: row.sourceId, byteLength: row.size, outputSha256: row.outputSha256 };
			} });
		if (entries.length > 16) throw RangeError('Loop preview fixture exceeds16entries.');
		return entries;
	});
}

async function withSelected<Result>(value: readonly string[], indexedDB: IDBFactory, run: (selected: Selected) => Promise<Result>): Promise<Result> {
	const ids = readClosedDomainArray(value, 'current loop photo IDs', 2, 2).map(value => {
		if (typeof value !== 'string' || !value || value.length > 256) throw TypeError('Loop photo IDs must be bounded strings.'); return value;
	});
	if (ids.length !== 2 || new Set(ids).size !== 2) throw RangeError('Loop fixture requires exactly two distinct photo IDs.');
	const anchor = new PhotoMediaStoreV1({ indexedDB });
	let media: PhotoMediaStoreV1 | null = null, catalog: PhotoCatalogRepositoryV2 | null = null, database: IDBDatabase | null = null;
	try {
		const ports = { settings: anchor.settingsRepository, async initializeDefault() { throw Error('Loop fixture requires an existing selected library.'); } };
		const selected = await readPhotoLibrarySessionLocationV2(ports), location = selected.location;
		media = new PhotoMediaStoreV1({ indexedDB, databaseName: location.mediaDatabaseName, preferOpfs: location.namespaceToken === null });
		const resources = await media.getCubeLutResources();
		catalog = new PhotoCatalogRepositoryV2({ indexedDB, databaseName: location.catalogDatabaseName, verifyOriginal: media.verifyOriginal,
			verifyResources: (photo, signal) => resources.verifyPhoto(photo, signal) });
		const root = await catalog.loadCatalog(location.catalogId);
		if (!root || root.photoCount !== 2) throw Error('Loop fixture requires a two-photo catalog.');
		const photos: (PhotoDocumentV1 | PhotoDocumentV2)[] = [];
		for (const id of ids) {
			const photo = await catalog.loadPhoto(root.id, id);
			if (!photo || photo.original.byteLength > 1024) throw Error('Loop photo is missing or original exceeds1KiB.');
			await resources.verifyPhoto(photo); await media.verifyOriginal(photo.original); photos.push(photo);
		}
		if (JSON.stringify(await readPhotoLibrarySessionLocationV2(ports)) !== JSON.stringify(selected)) throw Error('Loop selected namespace changed.');
		database = await openDatabase(indexedDB, location.mediaDatabaseName);
		return await run({ location, media, database, photos });
	} finally { database?.close(); await Promise.all([catalog?.close(), media?.close(), anchor.close()]); }
}

async function digest(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
}
