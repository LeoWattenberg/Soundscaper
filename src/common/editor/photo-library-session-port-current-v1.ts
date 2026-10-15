/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibrarySessionPortV2, ReadPhotoExportSidecar, PhotoLibraryExportJournalPort } from './photo-library-session-port-v2.ts';
import type { PhotoLibraryBatchRenamePortV1 } from './photo-library-batch-rename-port-v1.ts';
import type { PhotoLibraryDevelopPortCurrentV1 } from './photo-library-develop-port-current-v1.ts';
import type { PhotoLibraryDevelopPortV2 } from './photo-library-develop-port-v2.ts';
import type { PhotoLibraryImageHandoffPortV2 } from './photo-library-image-handoff-port-v2.ts';
import type { PhotoLibraryImageReceivePortV2 } from './photo-library-image-receive-port-v2.ts';
import type { PhotoLibraryCollectionHandoffPortV2 } from './photo-library-collection-handoff-port-v2.ts';
import type { PhotoLibraryDevelopImportPortCurrentV1 } from './photo-library-develop-import-port-current-v1.ts';
import type { PhotoLibraryExportPresetsPortCurrentV1 } from './photo-library-export-presets-port-current-v1.ts';
import type { PhotoLibraryPreviewTierV1, PhotoLibraryPreviewOutcomeV1 } from './photo-library-session-port-v1.ts';

export type PhotoLibraryRawPreviewSourceCurrentV1 = 'neutral-original' | 'camera-embedded';
export interface PhotoLibraryPreviewReadOptionsCurrentV1 {
	readonly signal?: AbortSignal;
	readonly rawPreviewSource?: PhotoLibraryRawPreviewSourceCurrentV1;
}

/** Current Develop settings with unchanged scalar library and organization capabilities. */
export interface PhotoLibrarySessionPortCurrentV1 extends Omit<PhotoLibrarySessionPortV2, 'develop' | 'readPreview'> {
	readPreview(photoId: string, tier: PhotoLibraryPreviewTierV1, options?: Readonly<PhotoLibraryPreviewReadOptionsCurrentV1>): Promise<PhotoLibraryPreviewOutcomeV1>;
	readonly develop: Readonly<PhotoLibraryDevelopPortCurrentV1>;
	/** Whole Current Photo admission; inherited batch rename methods remain strict Photo1/2. */
	readonly batchRenameCurrent?: Readonly<PhotoLibraryBatchRenamePortV1>;
	/** A genuine legacy capability, admitted against the complete retained Photo1/2 document. */
	readonly legacyDevelop?: Readonly<PhotoLibraryDevelopPortV2>;
	/** Full retained Current provenance; the inherited legacy reader stays strict. */
	readonly readExportSidecarCurrent?: ReadPhotoExportSidecar;
	/** Same scalar journal wire, verified against the complete selected Current Photo. */
	readonly exportJournalCurrent?: Readonly<PhotoLibraryExportJournalPort>;
	readonly exportPresetsCurrent?: Readonly<PhotoLibraryExportPresetsPortCurrentV1>;
	/** Complete Current Photo admission and joined LUT/brush transport. */
	readonly imageHandoffCurrent?: Readonly<PhotoLibraryImageHandoffPortV2>;
	/** Explicit Current native publication; the inherited legacy child stays strict. */
	readonly imageReceiveCurrent?: Readonly<PhotoLibraryImageReceivePortV2>;
	/** Native ordered Current sequence capture; the inherited legacy child stays strict. */
	readonly collectionHandoffCurrent?: Readonly<PhotoLibraryCollectionHandoffPortV2>;
	/** Selected Current presets share the existing managed import and writer. */
	readonly developImportCurrent?: Readonly<PhotoLibraryDevelopImportPortCurrentV1>;
}
export type CreatePhotoLibrarySessionCurrentV1 = () => Promise<PhotoLibrarySessionPortCurrentV1>;
