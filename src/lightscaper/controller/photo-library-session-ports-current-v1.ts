/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoCatalogRepositoryCurrentV1 } from '../catalog/photo-catalog-repository-current-v1.ts';
import type { PhotoManagedImportPortsCurrentV1 } from '../import/managed-import-ports-current-v1.ts';
import type { PhotoLibrarySessionPortsV2 } from './photo-library-session-ports-v2.ts';

export interface PhotoLibrarySessionPortsCurrentV1 extends Omit<PhotoLibrarySessionPortsV2, 'catalog' | 'verifyResources'> {
	readonly catalog: Pick<PhotoCatalogRepositoryCurrentV1, 'loadCatalog' | 'loadPhoto' | 'publishPhotos' | 'savePhoto' | 'saveCatalog'
		| 'readSummaryPage' | 'readQueryPage' | 'rebuildQueryIndexPage'>
		& Partial<Pick<PhotoCatalogRepositoryCurrentV1, 'readQueryPageV2' | 'rebuildQueryIndexPageV2' | 'readCullingDestinationPage'>>;
	readonly verifyResources?: PhotoManagedImportPortsCurrentV1['verifyResources'];
}
