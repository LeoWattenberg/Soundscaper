/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoRasterExportBatchQueueKernelV1 } from './internal/photo-raster-export-batch-queue-kernel-v1.ts';
import type { PhotoRasterExportBatchRuntime } from './internal/photo-raster-export-batch-queue-kernel-v1.ts';
export { PhotoRasterExportBatchError } from './internal/photo-raster-export-batch-queue-kernel-v1.ts';
export type { PhotoRasterExportBatchDestinations, PhotoRasterExportBatchRuntime, PhotoRasterExportBatchReceipt, PhotoRasterExportBatchFailure } from './internal/photo-raster-export-batch-queue-kernel-v1.ts';

export class PhotoRasterExportBatchQueue extends PhotoRasterExportBatchQueueKernelV1 {
	constructor(value: PhotoRasterExportBatchRuntime) { super('legacy2', value); }
}
