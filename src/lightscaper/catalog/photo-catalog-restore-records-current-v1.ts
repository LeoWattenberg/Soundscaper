/* SPDX-License-Identifier: AGPL-3.0-only */

import { photoCatalogRestorePhotoRecordsForProfileV1, type PhotoCatalogRestorePhotoRecordsForProfileV1 } from './internal/photo-catalog-restore-records-kernel-v1.ts';
export type PhotoCatalogRestorePhotoRecordsCurrentV1 = PhotoCatalogRestorePhotoRecordsForProfileV1<'current4'>;
export function photoCatalogRestorePhotoRecordsCurrentV1(root: unknown, value: unknown): PhotoCatalogRestorePhotoRecordsCurrentV1 {
	return photoCatalogRestorePhotoRecordsForProfileV1('current4', root, value);
}
