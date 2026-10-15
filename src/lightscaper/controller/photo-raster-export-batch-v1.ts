/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoRasterExportOutput } from './photo-raster-export-contract-v1.ts';
import type { PhotoRasterBatchGraphicIntentV1 } from './photo-raster-export-batch-graphic-v1.ts';
import { capturePhotoRasterExportBatchForProfileV1 } from './internal/photo-raster-export-batch-kernel-v1.ts';
export { PHOTO_RASTER_EXPORT_BATCH_MAXIMUM_MEMBERS_V1 } from './internal/photo-raster-export-batch-kernel-v1.ts';

export interface PhotoRasterExportBatchMemberV1 {
	readonly jobId: string; readonly index: number; readonly photoId: string;
	readonly versionId: string; readonly expectedRevision: number;
	readonly sourceFileName: string; readonly fileName: string;
}
export interface PhotoRasterExportBatchV1 {
	readonly schemaVersion: 1; readonly batchId: string; readonly format: 'png' | 'jpeg';
	readonly members: readonly Readonly<PhotoRasterExportBatchMemberV1>[];
	readonly output?: Readonly<PhotoRasterExportOutput>;
	readonly sidecarEnabled?: true;
	readonly graphicWatermark?: Readonly<PhotoRasterBatchGraphicIntentV1>;
}

/** Permanent Output1 admission; it never accepts the Current depth extension. */
export function capturePhotoRasterExportBatchV1(value: unknown): Readonly<PhotoRasterExportBatchV1> {
	return capturePhotoRasterExportBatchForProfileV1('legacy2', value);
}
