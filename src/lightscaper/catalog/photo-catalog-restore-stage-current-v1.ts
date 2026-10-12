/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoCatalogRestoreStageForProfileV1, type PhotoCatalogRestoreStageOptionsV2, type PhotoCatalogRestoreStageV2 } from './internal/photo-catalog-restore-stage-kernel-v1.ts';
export type PhotoCatalogRestoreStageOptionsCurrentV1 = PhotoCatalogRestoreStageOptionsV2;
export type PhotoCatalogRestoreStageCurrentV1 = PhotoCatalogRestoreStageV2;
export function createPhotoCatalogRestoreStageCurrentV1(options: PhotoCatalogRestoreStageOptionsCurrentV1): Promise<PhotoCatalogRestoreStageCurrentV1> {
	return createPhotoCatalogRestoreStageForProfileV1('current3', options);
}
