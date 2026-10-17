/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoCatalogRepositoryCurrentV1 } from '../catalog/photo-catalog-repository-current-v1.ts';
import type { PhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { capturePhotoManagedImportPortsForProfileV1 } from './managed-import-ports-v2.ts';
import type { PhotoManagedImportPortsV2 } from './managed-import-ports-v2.ts';

export interface PhotoManagedImportPortsCurrentV1 extends Omit<PhotoManagedImportPortsV2, 'catalog' | 'verifyResources'> {
	readonly catalog: Pick<PhotoCatalogRepositoryCurrentV1, 'loadCatalog' | 'loadPhoto' | 'publishPhotos'>;
	readonly verifyResources?: (photo: PhotoDocumentCurrentV1, signal?: AbortSignal) => Promise<void>;
}

export function capturePhotoManagedImportPortsCurrentV1(ports: PhotoManagedImportPortsCurrentV1): Readonly<PhotoManagedImportPortsCurrentV1> {
	return capturePhotoManagedImportPortsForProfileV1(ports);
}
