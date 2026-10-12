/* SPDX-License-Identifier: AGPL-3.0-only */

import { photoCatalogRestorePhotoRecordsForProfileV1, type PhotoCatalogRestorePhotoRecordsForProfileV1 } from './internal/photo-catalog-restore-records-kernel-v1.ts';
export { photoCatalogRestoreRootRecordsV1, photoCatalogRestoreStackRecordsV1, photoCatalogRestoreSavedCollectionRecordsV1,
	type PhotoCatalogRestoreRootRecordsV1 } from './photo-catalog-restore-records-v1.ts';
export type PhotoCatalogRestorePhotoRecordsV2 = PhotoCatalogRestorePhotoRecordsForProfileV1<'legacy2'>;
export function photoCatalogRestorePhotoRecordsV2(root: unknown, value: unknown): PhotoCatalogRestorePhotoRecordsV2 {
	return photoCatalogRestorePhotoRecordsForProfileV1('legacy2', root, value);
}
