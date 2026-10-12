/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { capturePhotoLibraryBackupMetadataWalkForProfileV1, type PhotoLibraryBackupMetadataCatalogForProfileV1,
	type PhotoLibraryBackupMetadataWalkForProfileV1 } from './internal/photo-library-backup-metadata-walk-kernel-v1.ts';
export type PhotoLibraryBackupMetadataCatalogCurrentV1 = PhotoLibraryBackupMetadataCatalogForProfileV1<'current3'>;
export type PhotoLibraryBackupMetadataWalkCurrentV1 = PhotoLibraryBackupMetadataWalkForProfileV1<'current3'>;

export function capturePhotoLibraryBackupMetadataWalkCurrentV1(catalogValue: unknown,
	catalog: PhotoLibraryBackupMetadataCatalogCurrentV1, admitPhoto: (photo: PhotoDocumentCurrentV1) => void, signal?: AbortSignal): Promise<Readonly<PhotoLibraryBackupMetadataWalkCurrentV1>> {
	return capturePhotoLibraryBackupMetadataWalkForProfileV1('current3', catalogValue, catalog, admitPhoto, signal);
}
