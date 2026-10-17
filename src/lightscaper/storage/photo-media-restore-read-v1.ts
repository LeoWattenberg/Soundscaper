/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord, readClosedDomainField } from '../../common/editor/closed-domain-value.ts';
import { aggregateScapeErrors } from '../../common/editor/scape-abort.ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { request, readCursorPage } from '../../common/editor/storage/indexeddb-backend.ts';
import { trustedMediaContentSha256 } from '../../common/editor/storage/media-content-provenance.ts';
import { MEDIA_ASSET_CHUNK_STORAGE_TYPE, MEDIA_ASSET_STREAM_CHUNK_BYTES } from '../../common/editor/storage/media-asset-chunk-schema.ts';
import { mediaAssetChunkKey } from '../../common/editor/storage/media-asset-chunk-records.ts';
import { normalizeCatalogOriginalRoot, catalogOriginalKey, type CatalogOriginalReferenceV1 } from '../../common/editor/storage/media-catalog-original-schema.ts';
import type { StorageRecord } from '../../common/editor/storage/media-records.ts';
import { catalogTransaction } from '../catalog/catalog-transaction.ts';
import { readValidatedPhotoCatalogRootV1 } from '../catalog/documents.ts';
import { readStoredPhoto, readIndexState } from '../catalog/repository-records.ts';
import { readPhotoQueryBuildStateV2 } from '../catalog/photo-query-index-storage-v2.ts';
import { assertPhotoCatalogRestoreNamespaceProfileV1, assertPhotoCatalogRestoreOwnerV1 } from '../catalog/photo-catalog-restore-owner-v1.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import { assertPhotoLibraryRestoreOwnerMarkerV1, PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1, PHOTO_CATALOG_RESTORE_OWNER_STORE_V1,
	type PhotoLibraryRestoreAllocationV1 } from './photo-library-restore-ownership-v1.ts';
import { checkMediaRestoreSignalV1, mediaRestoreCancellationV1 } from './photo-media-restore-signal-v1.ts';

export type PhotoMediaRestoreBindingV1 = Readonly<CatalogOriginalReferenceV1>;
export interface PhotoMediaRestoreDescriptorV1 {
	readonly assetId: string; readonly sha256: string; readonly size: number; readonly token: string;
	readonly chunkToken: string; readonly chunkCount: number; readonly rootCount: number;
}

/** Version-omitted existing-entry acquisition. Absent upgrade is aborted, never migrated or adopted. */
export function openMediaRestoreExistingV1(open: IDBFactory['open'], name: string, signal: AbortSignal): Promise<IDBDatabase> {
	checkMediaRestoreSignalV1(signal);
	return new Promise((resolve, reject) => {
		const opening = open(name); let absent = false, failed = false, failure: unknown;
		opening.onupgradeneeded = event => {
			try { checkMediaRestoreSignalV1(signal); if (event.oldVersion !== 0 || !opening.transaction) throw new Error('Unexpected restore inspection upgrade.');
				opening.transaction.abort(); absent = true;
			} catch (error) { failed = true; failure = error; try { opening.transaction?.abort(); } catch { /* Join terminal open. */ } }
		};
		opening.onerror = () => {
			try { checkMediaRestoreSignalV1(signal); reject(failed ? failure : absent ? new ReferenceError('Restore namespace is absent.') : opening.error); }
			catch (error) { reject(error); }
		};
		opening.onsuccess = () => {
			try { checkMediaRestoreSignalV1(signal); if (failed || absent) throw failed ? failure : new Error('Restore absence probe committed.'); resolve(opening.result); }
			catch (error) { try { opening.result.close(); } catch (cleanup) { reject(aggregateScapeErrors(error, [cleanup], 'Restore read acquisition cleanup failed.', { primaryIsAbort: mediaRestoreCancellationV1(error, signal) })); return; } reject(error); }
		};
	});
}

export async function assertMediaRestoreOwnerV1(stores: Readonly<Record<string, IDBObjectStore>>, allocation: PhotoLibraryRestoreAllocationV1): Promise<void> {
	const row = readClosedDomainRecord(await request(stores.settings!.get(PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1)), 'media restore owner', ['key', 'value']);
	if (readClosedDomainField(row, 'key', 'media restore owner') !== PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1) throw new Error('Media restore owner is missing.');
	assertPhotoLibraryRestoreOwnerMarkerV1(readClosedDomainField(row, 'value', 'media restore owner'), allocation, 'media');
}
export function mediaRestoreDescriptorV1(value: unknown, assetId: string): PhotoMediaRestoreDescriptorV1 {
	const row = value as StorageRecord | undefined;
	if (!row || row.sourceId !== assetId || !trustedMediaContentSha256(row)
		|| row.storage !== MEDIA_ASSET_CHUNK_STORAGE_TYPE || row.path != null || row.blob !== undefined
		|| typeof row.size !== 'number' || !Number.isSafeInteger(row.size) || row.size < 1 || row.size > 512 * 1024 * 1024
		|| row.mediaChunkBytes !== MEDIA_ASSET_STREAM_CHUNK_BYTES || typeof row.mediaChunkToken !== 'string' || !/^[a-zA-Z0-9._:-]{1,512}$/u.test(row.mediaChunkToken)
		|| row.mediaChunkCount !== Math.ceil(row.size / MEDIA_ASSET_STREAM_CHUNK_BYTES)
		|| !Number.isSafeInteger(row.catalogRootCount ?? 0) || Number(row.catalogRootCount ?? 0) < 0) throw new TypeError('Restore media descriptor is malformed.');
	return Object.freeze({ assetId, sha256: row.sha256 as string, size: row.size, token: row.mediaContentToken!,
		chunkToken: row.mediaChunkToken, chunkCount: row.mediaChunkCount as number, rootCount: Number(row.catalogRootCount ?? 0) });
}
export async function readMediaRestoreDescriptorV1(database: IDBDatabase, allocation: PhotoLibraryRestoreAllocationV1,
	assetId: string, signal: AbortSignal): Promise<PhotoMediaRestoreDescriptorV1 | null> {
	return catalogTransaction(database, ['settings', 'mediaAssets'], 'readonly', async stores => {
		await assertMediaRestoreOwnerV1(stores, allocation); const row: unknown = await request(stores.mediaAssets!.get(assetId));
		return row === undefined ? null : mediaRestoreDescriptorV1(row, assetId);
	}, signal);
}

/** One decoded <=2MiB document at a time; retained page contains <=64 scalar original bindings only. */
export async function readMediaRestoreCatalogPageV1(database: IDBDatabase, allocation: PhotoLibraryRestoreAllocationV1,
	root: PhotoCatalogRootV1, afterKey: string | null, signal: AbortSignal): Promise<readonly PhotoMediaRestoreBindingV1[]> {
	assertPhotoCatalogRestoreNamespaceProfileV1(database, allocation);
	return catalogTransaction(database, ['catalogs', 'catalogStates', 'photos', 'photoQueryBuildStatesV2', PHOTO_CATALOG_RESTORE_OWNER_STORE_V1], 'readonly', async stores => {
		await assertPhotoCatalogRestoreOwnerV1(stores[PHOTO_CATALOG_RESTORE_OWNER_STORE_V1]!, allocation);
		const current = readValidatedPhotoCatalogRootV1(await request(stores.catalogs!.get(root.id)));
		const index = readIndexState(await request(stores.catalogStates!.get(root.id)));
		const build = readPhotoQueryBuildStateV2(await request(stores.photoQueryBuildStatesV2!.get(root.id)), root.id);
		if (JSON.stringify(current) !== JSON.stringify(root) || index.rootRevision !== root.revision || index.indexRevision !== 0
			|| index.id !== root.id || index.photoCount !== root.photoCount || !build.ready || build.indexedCount !== root.photoCount || build.afterKey !== null) {
			throw new Error('Catalog restore candidate is not exactly finished.');
		}
		return Object.freeze(await readCursorPage(stores.photos!, { afterPrimaryKey: afterKey ?? undefined, limit: 64,
			project(value, key) {
				const photo = readStoredPhoto(value);
				if (photo.catalogId !== root.id || key !== `${root.id}|${photo.id}`) throw new Error('Restore photo scope/key differs.');
				return Object.freeze({ photoId: photo.id, assetId: photo.original.storageKey, sourceId: photo.original.id,
					sha256: photo.original.contentSha256, size: photo.original.byteLength });
			} }));
	}, signal);
}

export async function assertMediaRestorePhotoRootV1(database: IDBDatabase, allocation: PhotoLibraryRestoreAllocationV1,
	binding: PhotoMediaRestoreBindingV1, signal: AbortSignal): Promise<void> {
	await catalogTransaction(database, ['settings', 'mediaAssets', 'catalogOriginalRoots'], 'readonly', async stores => {
		await assertMediaRestoreOwnerV1(stores, allocation);
		const root = normalizeCatalogOriginalRoot(await request(stores.catalogOriginalRoots!.get(catalogOriginalKey(allocation.catalogId, allocation.operationId, binding.photoId))));
		const descriptor = mediaRestoreDescriptorV1(await request(stores.mediaAssets!.get(binding.assetId)), binding.assetId);
		if (root.catalogId !== allocation.catalogId || root.importId !== allocation.operationId || root.photoId !== binding.photoId
			|| root.assetId !== binding.assetId || root.sourceId !== binding.sourceId || root.sha256 !== binding.sha256 || root.size !== binding.size
			|| root.mediaContentToken !== descriptor.token || descriptor.sha256 !== binding.sha256 || descriptor.size !== binding.size) throw new Error('Stored photo original differs from its media custody.');
	}, signal);
}

/** Native chunk points are hashed synchronously before the next request; no whole-body Blob/parts array. */
export async function verifyMediaRestoreAssetV1(database: IDBDatabase, allocation: PhotoLibraryRestoreAllocationV1,
	assetId: string, signal: AbortSignal): Promise<PhotoMediaRestoreDescriptorV1> {
	return catalogTransaction(database, ['settings', 'mediaAssets', 'mediaAssetChunks', 'catalogOriginalRoots'], 'readonly', async stores => {
		await assertMediaRestoreOwnerV1(stores, allocation);
		const descriptor = mediaRestoreDescriptorV1(await request(stores.mediaAssets!.get(assetId)), assetId), digest = sha256.create();
		let roots = 0, after: string | null = null;
		do {
			const page: string[] = await readCursorPage(stores.catalogOriginalRoots!.index('assetId'), { query: assetId, afterPrimaryKey: after ?? undefined, limit: 64,
				project(value, key) { const root = normalizeCatalogOriginalRoot(value);
					if (root.key !== key || root.catalogId !== allocation.catalogId || root.importId !== allocation.operationId || root.assetId !== assetId
						|| root.sha256 !== descriptor.sha256 || root.size !== descriptor.size || root.mediaContentToken !== descriptor.token) throw new Error('Restore asset root provenance differs.'); return root.key; } });
			roots += page.length; if (roots > descriptor.rootCount) throw new Error('Restore media custody count differs.');
			after = page.length === 64 ? page.at(-1)! : null;
		} while (after !== null);
		if (roots < 1 || roots !== descriptor.rootCount) throw new Error('Restore media custody count differs.');
		for (let index = 0; index < descriptor.chunkCount; index++) {
			checkMediaRestoreSignalV1(signal);
			const key = mediaAssetChunkKey(descriptor.chunkToken, index), chunk = await request(stores.mediaAssetChunks!.get(key)) as Record<string, unknown> | undefined;
			const size = Math.min(MEDIA_ASSET_STREAM_CHUNK_BYTES, descriptor.size - index * MEDIA_ASSET_STREAM_CHUNK_BYTES);
			if (!chunk || chunk.key !== key || chunk.sourceId !== assetId || chunk.mediaChunkToken !== descriptor.chunkToken || chunk.index !== index
				|| chunk.payloadEncoding !== 'array-buffer-v1' || Object.hasOwn(chunk, 'payload') || !(chunk.payloadBytes instanceof ArrayBuffer)
				|| chunk.byteLength !== size || chunk.payloadBytes.byteLength !== size) throw new Error('Restore media chunk geometry/ownership differs.');
			digest.update(new Uint8Array(chunk.payloadBytes));
		}
		if (bytesToHex(digest.digest()) !== descriptor.sha256) throw new Error('Restore media body SHA-256 differs.');
		return descriptor;
	}, signal);
}
