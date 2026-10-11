/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoRasterExportSidecarKernelV1 } from './internal/photo-raster-export-sidecar-kernel-v1.ts';
import type { PhotoRasterExportRequestCurrentV1 } from './photo-raster-export-contract-v1.ts';

export class PhotoRasterExportSidecarCurrentV1 extends PhotoRasterExportSidecarKernelV1 {
	constructor(value: unknown, save: PhotoRasterExportRequestCurrentV1['saveFile']) { super('current3', value, save); }
}
