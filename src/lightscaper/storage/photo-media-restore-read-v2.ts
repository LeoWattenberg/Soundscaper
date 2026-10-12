/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, readCursorPage } from '../../common/editor/storage/indexeddb-backend.ts';
import { catalogTransaction } from '../catalog/catalog-transaction.ts';
import { readValidatedPhotoCatalogRootV1 } from '../catalog/documents.ts';
import { readStoredPhotoCurrentV1 } from '../catalog/photo-catalog-records-current-v1.ts';
import { assertPhotoCatalogRestoreProfileV1, type PhotoCatalogRestoreProfileV1, type PhotoCatalogRestorePhotoForProfileV1 } from '../catalog/internal/photo-catalog-restore-records-kernel-v1.ts';
import { readStoredPhotoV1OrV2 } from '../catalog/photo-catalog-records-v2.ts';
import { readIndexState } from '../catalog/repository-records.ts';
import { readPhotoQueryBuildStateV2 } from '../catalog/photo-query-index-storage-v2.ts';
import { assertPhotoCatalogRestoreNamespaceProfileV1, assertPhotoCatalogRestoreOwnerV1 } from '../catalog/photo-catalog-restore-owner-v1.ts';
import type { PhotoCatalogRootV1, PhotoDocumentV1 } from '../catalog/types.ts';
import type { PhotoDocumentV2 } from '../catalog/photo-document-v2.ts';
import { PHOTO_CATALOG_RESTORE_OWNER_STORE_V1, type PhotoLibraryRestoreAllocationV1 } from './photo-library-restore-ownership-v1.ts';
import type { PhotoMediaRestoreBindingV1 } from './photo-media-restore-read-v1.ts';

/** Full mixed owning admission precedes scalar projection. The optional internal
 * visitor settles synchronously; no document survives the <=64-binding page. */
export async function readMediaRestoreCatalogPageV2(database: IDBDatabase, allocation: PhotoLibraryRestoreAllocationV1,
	root: PhotoCatalogRootV1, afterKey: string | null, signal: AbortSignal,
	visit?: (photo: PhotoDocumentV1 | PhotoDocumentV2) => void): Promise<readonly PhotoMediaRestoreBindingV1[]> {
	return readMediaRestoreCatalogPageForProfileV1('legacy2', database, allocation, root, afterKey, signal, visit);
}
export async function readMediaRestoreCatalogPageForProfileV1<Profile extends PhotoCatalogRestoreProfileV1>(profile: Profile, database: IDBDatabase, allocation: PhotoLibraryRestoreAllocationV1,
	root: PhotoCatalogRootV1, afterKey: string | null, signal: AbortSignal,
	visit?: (photo: PhotoCatalogRestorePhotoForProfileV1<Profile>) => void): Promise<readonly PhotoMediaRestoreBindingV1[]> {
	assertPhotoCatalogRestoreProfileV1(profile);
	if (visit !== undefined && typeof visit !== 'function') throw new TypeError('Restore photo visitor requires a function.');
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
				if (typeof key !== 'string') throw new TypeError('Restore photo requires a scalar key.');
				const photo = (profile === 'legacy2' ? readStoredPhotoV1OrV2(value, key) : readStoredPhotoCurrentV1(value, key)) as PhotoCatalogRestorePhotoForProfileV1<Profile>;
				if (photo.catalogId !== root.id || key !== `${root.id}|${photo.id}`) throw new Error('Restore photo scope/key differs.');
				if (visit) Reflect.apply(visit, undefined, [photo]);
				return Object.freeze({ photoId: photo.id, assetId: photo.original.storageKey, sourceId: photo.original.id,
					sha256: photo.original.contentSha256, size: photo.original.byteLength });
			} }));
	}, signal);
}
