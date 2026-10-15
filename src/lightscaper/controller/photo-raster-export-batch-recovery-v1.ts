/* SPDX-License-Identifier: AGPL-3.0-only */
import { reconcilePhotoRasterExportBatchRecoveryForProfileV1, type PhotoRasterExportRecoveryEntryV1 } from './internal/photo-raster-export-batch-recovery-kernel-v1.ts';
export type { PhotoRasterExportRecoveryEntryV1 } from './internal/photo-raster-export-batch-recovery-kernel-v1.ts';

export function reconcilePhotoRasterExportBatchRecoveryV1(journal: unknown, current: unknown): readonly Readonly<PhotoRasterExportRecoveryEntryV1>[] {
	return reconcilePhotoRasterExportBatchRecoveryForProfileV1('legacy2', journal, current);
}
