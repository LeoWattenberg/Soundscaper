/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoRasterBatchSidecarRecoveryKernelV1 } from './internal/photo-raster-export-batch-sidecar-kernel-v1.ts';
import type { PhotoRasterExportRequest } from './photo-raster-export-contract-v1.ts';
export type { PhotoRasterBatchSidecarRecoveryReceipt } from './internal/photo-raster-export-batch-sidecar-kernel-v1.ts';
interface Runtime { readonly execute: PhotoRasterExportRequest['execute']; readonly read: NonNullable<PhotoRasterExportRequest['sidecar']>['read']; readonly save: PhotoRasterExportRequest['saveFile']; }

export class PhotoRasterBatchSidecarRecovery extends PhotoRasterBatchSidecarRecoveryKernelV1 {
	constructor(value: Runtime) { super('legacy2', value); }
}
