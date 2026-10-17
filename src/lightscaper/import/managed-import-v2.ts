/* SPDX-License-Identifier: AGPL-3.0-only */

import { importManagedPhotosForProfileV1, recoverManagedPhotoImportForProfileV1 } from './internal/managed-import-kernel-v1.ts';
import type { PhotoCatalogPackInputV2 } from '../archive/catalog-pack-v2.ts';
import type { PhotoManagedImportPortsV2, PhotoManagedImportOptionsV1, PhotoManagedImportReceiptV1 } from './managed-import-ports-v2.ts';
export { photoImportIntentKeyV1 } from './import-intent-v1.ts';
export type { PhotoManagedImportPortsV2, PhotoManagedImportReceiptV1 } from './managed-import-ports-v2.ts';
export function importManagedPhotosV2(catalogId: string, photos: Iterable<PhotoCatalogPackInputV2> | AsyncIterable<PhotoCatalogPackInputV2>, ports: PhotoManagedImportPortsV2, options: PhotoManagedImportOptionsV1 = {}): Promise<readonly PhotoManagedImportReceiptV1[]> {
	return importManagedPhotosForProfileV1('legacy2', catalogId, photos, ports, options);
}
export function recoverManagedPhotoImportV2(catalogId: string, ports: PhotoManagedImportPortsV2, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<void> {
	return recoverManagedPhotoImportForProfileV1('legacy2', catalogId, ports, options);
}
