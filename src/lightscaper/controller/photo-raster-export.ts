/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoRasterExportKernelV1 } from './internal/photo-raster-export-kernel-v1.ts';
import type { PhotoRasterExportRequest, PhotoRasterExportReceipt } from './photo-raster-export-contract-v1.ts';
export { capturePhotoRasterExportOutput, PhotoRasterExportMetadataRefusal, isPhotoRasterExportMetadataRefusal } from './photo-raster-export-contract-v1.ts';
export type { PhotoRasterExportRequest, PhotoRasterExportOutput, PhotoRasterExportReceipt, ReadPhotoExportMetadata } from './photo-raster-export-contract-v1.ts';

/** The original public owner keeps strict process1/2 and Sidecar1 admission. */
export class PhotoRasterExport extends PhotoRasterExportKernelV1 {
	constructor(format: 'png' | 'jpeg') { super('legacy2', format); }
	override start(value: PhotoRasterExportRequest): Promise<PhotoRasterExportReceipt> { return super.start(value); }
}
