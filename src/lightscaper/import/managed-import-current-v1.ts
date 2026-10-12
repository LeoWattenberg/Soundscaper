/* SPDX-License-Identifier: AGPL-3.0-only */

import { importManagedPhotosForProfileV1 } from './internal/managed-import-kernel-v1.ts';
import type { PhotoCatalogPackInputV4 } from '../archive/catalog-pack-v4.ts';
import type { PhotoManagedImportPortsCurrentV1 } from './managed-import-ports-current-v1.ts';
import type { PhotoManagedImportOptionsV1, PhotoManagedImportReceiptV1 } from './managed-import-ports-v2.ts';
/** Full Current publication retains the unchanged native Original intent/custody loop. */
export function importManagedPhotosCurrentV1(catalogId: string, photos: Iterable<PhotoCatalogPackInputV4> | AsyncIterable<PhotoCatalogPackInputV4>, ports: PhotoManagedImportPortsCurrentV1, options: PhotoManagedImportOptionsV1 = {}): Promise<readonly PhotoManagedImportReceiptV1[]> {
	return importManagedPhotosForProfileV1('current3', catalogId, photos, ports, options);
}
