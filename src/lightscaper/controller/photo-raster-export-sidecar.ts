/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoRasterExportSidecarKernelV1 } from './internal/photo-raster-export-sidecar-kernel-v1.ts';
import type { PhotoLibraryDevelopSettingsV2 } from '../../common/editor/photo-library-develop-port-v2.ts';
import type { PhotoLibraryExportSidecarRequest } from '../../common/editor/photo-library-session-port-v2.ts';
import type { PhotoRasterExportRequest } from './photo-raster-export-contract-v1.ts';
export type { PhotoRasterSidecarReceipt } from './internal/photo-raster-export-sidecar-kernel-v1.ts';

export class PhotoRasterExportSidecar extends PhotoRasterExportSidecarKernelV1 {
	constructor(value: unknown, save: PhotoRasterExportRequest['saveFile']) { super('legacy2', value, save); }
	override capture(binding: Readonly<PhotoLibraryExportSidecarRequest>, develop: Readonly<PhotoLibraryDevelopSettingsV2>, signal: AbortSignal): Promise<void> { return super.capture(binding, develop, signal); }
}
