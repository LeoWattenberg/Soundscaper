/* SPDX-License-Identifier: AGPL-3.0-only */

import { measurePhotoCatalogPackRecordV2 } from '../archive/catalog-pack-v2.ts';
import { assertPhotoMaskRasterPortableV1 } from '../catalog/photo-mask-raster-portability-v1.ts';
import { capturePhotoLibraryBackupMetadataWalkV1, type PhotoLibraryBackupMetadataCatalogV1,
	type PhotoLibraryBackupMetadataWalkV1 } from './photo-library-backup-metadata-walk-v1.ts';

export type { PhotoLibraryBackupMetadataCatalogV1 } from './photo-library-backup-metadata-walk-v1.ts';
export type PhotoLibraryBackupMetadataPreflightV1 = PhotoLibraryBackupMetadataWalkV1;

/** Legacy backup authority remains strict before any original/body demand. */
export function capturePhotoLibraryBackupMetadataPreflightV1(catalogValue: unknown,
	catalogPort: PhotoLibraryBackupMetadataCatalogV1, signal?: AbortSignal): Promise<Readonly<PhotoLibraryBackupMetadataPreflightV1>> {
	return capturePhotoLibraryBackupMetadataWalkV1(catalogValue, catalogPort, photo => {
		assertPhotoMaskRasterPortableV1(photo); measurePhotoCatalogPackRecordV2(photo);
	}, signal);
}
