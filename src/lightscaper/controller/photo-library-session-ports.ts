/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoPreviewSchedulerV1 } from '../preview/photo-preview-scheduler-v1.ts';
import type { PhotoCatalogRepositoryV1 } from '../catalog/repository.ts';
import type { PhotoCatalogRootV1, PhotoOriginalV1 } from '../catalog/types.ts';
import type { PhotoManagedImportPortsV1 } from '../import/managed-import-ports-v1.ts';
import type { PhotoCatalogImportExclusiveV1 } from '../import/catalog-write-lock-v1.ts';
import type { PhotoImportOutcomeV1, PhotoImportPreparedV1 } from '../import/photo-import-preparation-v1.ts';
import type { importManagedPhotosV1 } from '../import/managed-import-v1.ts';
import type { PhotoImportPresetSettingsPortV1 } from '../storage/photo-import-presets-v1.ts';
import type { PhotoDevelopPresetSettingsPortV1 } from '../storage/photo-develop-presets-v1.ts';
import type { MediaRepository } from '../../common/editor/storage/media-repository.ts';
import type { PhotoLibraryOriginalInspectionPortV1 } from './photo-library-original-inspection-v1.ts';
import type { PhotoLibraryStackRepositoryV1 } from './photo-library-stacks-v1.ts';

type Prepared = Pick<PhotoImportPreparedV1, 'outcome' | 'index' | 'fileName' | 'photo' | 'original' | 'keywordNames' | 'notices'>;
export type PhotoLibraryPreparationOutcomeV1 = Prepared | Extract<PhotoImportOutcomeV1, { outcome: 'failed' }>;

export type PhotoLibraryPreviewSchedulerPortV1 = Pick<PhotoPreviewSchedulerV1, 'request' | 'close'>;

export interface PhotoLibrarySessionPortsV1 {
	readonly smartCollections?: Pick<PhotoCatalogRepositoryV1, 'readSmartCollectionPage' | 'readSmartCollectionSnapshotV1'
		| 'readSmartCollectionQueryPageV1' | 'readSmartCollectionStackQueryPageV1' | 'saveSmartCollection' | 'deleteSmartCollection'>;
	readonly stacks?: PhotoLibraryStackRepositoryV1 & Pick<PhotoCatalogRepositoryV1, 'readStackQueryPage'>
		& Partial<Pick<PhotoCatalogRepositoryV1, 'readStackQueryPageV2'>>;
	readonly originalInspection?: PhotoLibraryOriginalInspectionPortV1;
	readonly originalRestoration?: Readonly<Pick<MediaRepository, 'restoreCatalogOriginalBody'>>;
	readonly backup?: Readonly<{
		readSnapshot: PhotoCatalogRepositoryV1['readSnapshot'];
		captureSmartCollectionArchiveV1: PhotoCatalogRepositoryV1['captureSmartCollectionArchiveV1'];
		loadOriginal: (original: PhotoOriginalV1, signal?: AbortSignal) => Promise<unknown>;
	}>;
	readonly createPreviewScheduler?: (catalogId: string) => Promise<PhotoLibraryPreviewSchedulerPortV1>;
	readonly catalog: Pick<PhotoCatalogRepositoryV1, 'loadCatalog' | 'loadPhoto' | 'publishPhotos' | 'savePhoto' | 'saveCatalog' | 'readSummaryPage' | 'readQueryPage' | 'rebuildQueryIndexPage'>
		& Partial<Pick<PhotoCatalogRepositoryV1, 'readQueryPageV2' | 'rebuildQueryIndexPageV2'>>;
	readonly media: PhotoManagedImportPortsV1['media'];
	readonly journal: PhotoManagedImportPortsV1['journal'];
	readonly settings?: PhotoImportPresetSettingsPortV1;
	readonly developPresetSettings?: PhotoDevelopPresetSettingsPortV1;
	readonly initialize: (signal: AbortSignal) => Promise<PhotoCatalogRootV1>;
	readonly closeResources: () => Promise<void>;
	readonly exclusive?: PhotoCatalogImportExclusiveV1;
	readonly prepare?: (request: unknown) => AsyncIterable<PhotoLibraryPreparationOutcomeV1>;
	readonly importPhotos?: typeof importManagedPhotosV1;
	readonly createId?: () => string;
	readonly now?: () => string;
}
