/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoRasterBatchSidecarRecoveryKernelV1 } from './internal/photo-raster-export-batch-sidecar-kernel-v1.ts';
import type { PhotoRasterExportRequestCurrentV1 } from './photo-raster-export-contract-v1.ts';
export interface PhotoRasterBatchSidecarRuntimeCurrentV1 { readonly execute: PhotoRasterExportRequestCurrentV1['execute'];
	readonly read: NonNullable<PhotoRasterExportRequestCurrentV1['sidecar']>['read']; readonly save: PhotoRasterExportRequestCurrentV1['saveFile']; }

export class PhotoRasterBatchSidecarRecoveryCurrentV1 extends PhotoRasterBatchSidecarRecoveryKernelV1 {
	constructor(value: PhotoRasterBatchSidecarRuntimeCurrentV1) { super('current3', value); }
}
