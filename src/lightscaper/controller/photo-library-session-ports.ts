/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoPreviewSchedulerV1 } from '../preview/photo-preview-scheduler-v1.ts';
import type { PhotoCatalogRepositoryV1 } from '../catalog/repository.ts';
import type { PhotoCatalogRootV1, PhotoOriginalV1 } from '../catalog/types.ts';
import type { PhotoManagedImportPortsV1 } from '../import/managed-import-ports-v1.ts';
import type { PhotoCatalogImportExclusiveV1 } from '../import/catalog-write-lock-v1.ts';
import type { PhotoImportOutcomeV1, PhotoImportPreparedV1 } from '../import/photo-import-preparation-v1.ts';
import type { importManagedPhotosV1 } from '../import/managed-import-v1.ts';
import type { PhotoImportPresetSettingsPortV1 } from '../storage/photo-import-presets-v1.ts';

type Prepared = Pick<PhotoImportPreparedV1, 'outcome' | 'index' | 'fileName' | 'photo' | 'original' | 'keywordNames' | 'notices'>;
export type PhotoLibraryPreparationOutcomeV1 = Prepared | Extract<PhotoImportOutcomeV1, { outcome: 'failed' }>;

export type PhotoLibraryPreviewSchedulerPortV1 = Pick<PhotoPreviewSchedulerV1, 'request' | 'close'>;

export interface PhotoLibrarySessionPortsV1 {
	readonly backup?: Readonly<{
		readSnapshot: PhotoCatalogRepositoryV1['readSnapshot'];
		loadOriginal: (original: PhotoOriginalV1, signal?: AbortSignal) => Promise<unknown>;
	}>;
	readonly createPreviewScheduler?: (catalogId: string) => Promise<PhotoLibraryPreviewSchedulerPortV1>;
	readonly catalog: Pick<PhotoCatalogRepositoryV1, 'loadCatalog' | 'loadPhoto' | 'publishPhotos' | 'savePhoto' | 'saveCatalog' | 'readSummaryPage' | 'readQueryPage' | 'rebuildQueryIndexPage'>;
	readonly media: PhotoManagedImportPortsV1['media'];
	readonly journal: PhotoManagedImportPortsV1['journal'];
	readonly settings?: PhotoImportPresetSettingsPortV1;
	readonly initialize: (signal: AbortSignal) => Promise<PhotoCatalogRootV1>;
	readonly closeResources: () => Promise<void>;
	readonly exclusive?: PhotoCatalogImportExclusiveV1;
	readonly prepare?: (request: unknown) => AsyncIterable<PhotoLibraryPreparationOutcomeV1>;
	readonly importPhotos?: typeof importManagedPhotosV1;
	readonly createId?: () => string;
	readonly now?: () => string;
}
