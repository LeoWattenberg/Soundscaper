/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoRasterExport } from './photo-raster-export.ts';
export type { PhotoRasterExportRequest as PhotoPngExportRequestV1, PhotoRasterExportReceipt as PhotoPngExportReceiptV1 } from './photo-raster-export.ts';

/** Compatible PNG entry point over the joined raster destination lifetime. */
export class PhotoPngExportV1 extends PhotoRasterExport {
	constructor() { super('png'); }
}
