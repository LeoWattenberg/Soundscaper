/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PhotoRasterExportBatchV1 } from './photo-raster-export-batch-v1.ts';
import type { PhotoRasterExportOutputCurrentV1 } from './photo-raster-export-output-current-v1.ts';
import { capturePhotoRasterExportBatchForProfileV1 } from './internal/photo-raster-export-batch-kernel-v1.ts';

export interface PhotoRasterExportBatchCurrentV1 extends Omit<PhotoRasterExportBatchV1, 'output'> {
	readonly output?: Readonly<PhotoRasterExportOutputCurrentV1>;
}
/** Outer Batch1 remains exact; only this fixed profile admits nested Output2. */
export function capturePhotoRasterExportBatchCurrentV1(value: unknown): Readonly<PhotoRasterExportBatchCurrentV1> {
	return capturePhotoRasterExportBatchForProfileV1('current3', value);
}
