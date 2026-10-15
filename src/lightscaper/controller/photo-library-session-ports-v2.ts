/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoCatalogRepositoryV2 } from '../catalog/photo-catalog-repository-v2.ts';
import type { importManagedPhotosV2 } from '../import/managed-import-v2.ts';
import type { PhotoManagedImportPortsV2 } from '../import/managed-import-ports-v2.ts';
import type { PhotoMediaCubeLutResourcesV1 } from '../storage/photo-media-cube-lut-resources-v1.ts';
import type { PhotoMediaMaskRasterResourcesV1 } from '../storage/photo-media-mask-raster-resources-v1.ts';
import type { PhotoPreviewSchedulerV2 } from '../preview/photo-preview-scheduler-v2.ts';
import type { PhotoPreviewJobOutcomeV1, PhotoPreviewPreparedCore } from '../preview/photo-preview-scheduler-core.ts';
import type { PhotoLibrarySessionPortsV1 } from './photo-library-session-ports.ts';
import type { PhotoLibraryExportJournalSettings } from '../../common/editor/photo-library-session-port-v2.ts';
import type { PhotoDevelopPresetSettingsPortV1 } from '../storage/photo-develop-presets-v1.ts';

export type PhotoLibraryPreviewSchedulerPortV2 = Pick<PhotoPreviewSchedulerV2, 'close'> & {
	request(value: unknown): Promise<PhotoPreviewJobOutcomeV1<PhotoPreviewPreparedCore>>;
};
export interface PhotoLibrarySessionPortsV2 extends Omit<PhotoLibrarySessionPortsV1, 'catalog' | 'importPhotos' | 'createPreviewScheduler'> {
	readonly catalog: Pick<PhotoCatalogRepositoryV2, 'loadCatalog' | 'loadPhoto' | 'publishPhotos' | 'savePhoto' | 'saveCatalog' | 'readSummaryPage' | 'readQueryPage' | 'rebuildQueryIndexPage'>
		& Partial<Pick<PhotoCatalogRepositoryV2, 'readQueryPageV2' | 'rebuildQueryIndexPageV2' | 'readCullingDestinationPage'>>;
	readonly createPreviewScheduler?: (catalogId: string) => Promise<PhotoLibraryPreviewSchedulerPortV2>;
	readonly importPhotos?: typeof importManagedPhotosV2;
	readonly cubeLutResources?: () => Promise<Readonly<PhotoMediaCubeLutResourcesV1>>;
	readonly maskRasterResources?: () => Promise<Readonly<PhotoMediaMaskRasterResourcesV1>>;
	readonly verifyResources?: PhotoManagedImportPortsV2['verifyResources'];
	readonly exportJournalSettings?: Readonly<PhotoLibraryExportJournalSettings>;
	readonly exportPresetSettings?: Readonly<PhotoDevelopPresetSettingsPortV1>;
}
