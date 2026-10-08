/* SPDX-License-Identifier: AGPL-3.0-only */

import type { KeyValueRepository } from '../../common/editor/storage/key-value-repository.ts';
import type { PhotoCatalogImportExclusiveV1 } from '../import/catalog-write-lock-v1.ts';
import { PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1 } from './photo-library-catalog-pointer.ts';
import { readPhotoLibraryLocationPointerV2, type PhotoLibraryLocationPointer } from './photo-library-location-v2.ts';
import type { PhotoLibrarySessionLocationV2 } from './photo-library-location-reader-v2.ts';
import { withPhotoLibraryNamespaceLocksV1, withPhotoLibraryLegacyCatalogLockV1, type PhotoLibraryWriteAuthorityV1 } from './photo-library-namespace-lock-v1.ts';

/** Fixed per-Session selection; every writer rechecks pointer authority under both physical leases. */
export function createPhotoLibrarySelectedExclusiveV2(settings: Pick<KeyValueRepository, 'get'>,
	selection: Readonly<PhotoLibrarySessionLocationV2>, locks: Pick<LockManager, 'request'> | null): PhotoCatalogImportExclusiveV1 {
	const read = settings.get.bind(settings), request = locks?.request.bind(locks);
	const captured = request ? Object.freeze({ request }) : null;
	const names = [selection.location.catalogDatabaseName, selection.location.mediaDatabaseName];
	return async (catalogId, operation, signal) => {
		if (catalogId !== selection.location.catalogId) throw new TypeError('Photo library writer catalog differs from its selected location.');
		return withPhotoLibraryNamespaceLocksV1(captured, names, async authority => {
			const run = async (current: PhotoLibraryWriteAuthorityV1) => {
				authority.assertActive(); current.assertActive();
				const pointer = readPhotoLibraryLocationPointerV2(await read(PHOTO_LIBRARY_CATALOG_POINTER_KEY_V1));
				authority.assertActive(); current.assertActive();
				if (!sameLocation(pointer, selection.pointer)) throw new Error('The selected photo library location changed.');
				return operation(current.signal);
			};
			// Old V1 windows only know the logical catalog lock. Share it while using the physical pair.
			if (selection.pointer.schemaVersion === 1) {
				return withPhotoLibraryLegacyCatalogLockV1(captured, catalogId, run, authority.signal);
			}
			return run(authority);
		}, signal);
	};
}

function sameLocation(left: PhotoLibraryLocationPointer, right: PhotoLibraryLocationPointer): boolean {
	return left.schemaVersion === right.schemaVersion && left.catalogId === right.catalogId
		&& (left.schemaVersion === 1 || (right.schemaVersion === 2 && left.namespaceToken === right.namespaceToken));
}
