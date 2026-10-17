/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoDocumentV1 } from '../catalog/types.ts';
import type { PhotoDocumentV2 } from '../catalog/photo-document-v2.ts';
import { capturePhotoLibraryBackupMetadataWalkForProfileV1, type PhotoLibraryBackupMetadataCatalogForProfileV1,
	type PhotoLibraryBackupMetadataWalkForProfileV1 } from './internal/photo-library-backup-metadata-walk-kernel-v1.ts';
export type PhotoLibraryBackupMetadataCatalogV1 = PhotoLibraryBackupMetadataCatalogForProfileV1<'legacy2'>;
export type PhotoLibraryBackupMetadataWalkV1 = PhotoLibraryBackupMetadataWalkForProfileV1<'legacy2'>;

/** Permanent strict legacy metadata owner. */
export function capturePhotoLibraryBackupMetadataWalkV1(catalogValue: unknown,
	catalog: PhotoLibraryBackupMetadataCatalogV1, admitPhoto: (photo: PhotoDocumentV1 | PhotoDocumentV2) => void, signal?: AbortSignal): Promise<Readonly<PhotoLibraryBackupMetadataWalkV1>> {
	return capturePhotoLibraryBackupMetadataWalkForProfileV1('legacy2', catalogValue, catalog, admitPhoto, signal);
}
