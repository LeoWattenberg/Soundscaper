/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoRasterExportKernelV1 } from './internal/photo-raster-export-kernel-v1.ts';
import type { PhotoRasterExportRequestCurrentV1, PhotoRasterExportReceipt } from './photo-raster-export-contract-v1.ts';
export type { PhotoRasterExportRequestCurrentV1 } from './photo-raster-export-contract-v1.ts';

/** Current saved recipes select canonical or explicitly derived RAW input. */
export class PhotoRasterExportCurrentV1 extends PhotoRasterExportKernelV1 {
	constructor(format: 'png' | 'jpeg') { super('current3', format); }
	override start(value: PhotoRasterExportRequestCurrentV1): Promise<PhotoRasterExportReceipt> { return super.start(value); }
}
