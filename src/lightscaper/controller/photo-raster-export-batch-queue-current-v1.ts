/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoRasterExportBatchQueueKernelV1 } from './internal/photo-raster-export-batch-queue-kernel-v1.ts';
import type { PhotoRasterExportBatchRuntimeCurrentV1 } from './internal/photo-raster-export-batch-queue-kernel-v1.ts';
export type { PhotoRasterExportBatchRuntimeCurrentV1 } from './internal/photo-raster-export-batch-queue-kernel-v1.ts';

export class PhotoRasterExportBatchQueueCurrentV1 extends PhotoRasterExportBatchQueueKernelV1 {
	constructor(value: PhotoRasterExportBatchRuntimeCurrentV1) { super('current3', value); }
}
