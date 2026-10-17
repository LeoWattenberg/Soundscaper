/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoCatalogRestoreStageForProfileV1, type PhotoCatalogRestoreStageOptionsV2, type PhotoCatalogRestoreStageV2 } from './internal/photo-catalog-restore-stage-kernel-v1.ts';
export type { PhotoCatalogRestoreCandidateV2, PhotoCatalogRestoreStageV2, PhotoCatalogRestoreStageOptionsV2 } from './internal/photo-catalog-restore-stage-kernel-v1.ts';
export function createPhotoCatalogRestoreStageV2(options: PhotoCatalogRestoreStageOptionsV2): Promise<PhotoCatalogRestoreStageV2> {
	return createPhotoCatalogRestoreStageForProfileV1('legacy2', options);
}
