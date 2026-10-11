/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryExportSidecarRequest, ReadPhotoExportSidecar } from '../../common/editor/photo-library-session-port-v2.ts';
import type { PhotoRasterExportBindingV1 } from '../storage/photo-raster-export-journal-v1.ts';
import { PhotoRasterPersistedBatchKernelV1, readPhotoRasterExportBindingForProfileV1,
	type PhotoRasterPersistedBatchOptionsCurrentV1, type PhotoRasterPersistedBatchPreparedV1 } from './internal/photo-raster-export-persisted-batch-kernel-v1.ts';
export type { PhotoRasterPersistedBatchOptionsCurrentV1 } from './internal/photo-raster-export-persisted-batch-kernel-v1.ts';

export function readPhotoRasterExportBindingCurrentV1(request: Readonly<PhotoLibraryExportSidecarRequest>, read: ReadPhotoExportSidecar, signal: AbortSignal, sidecarEnabled = false): Promise<Readonly<PhotoRasterExportBindingV1>> {
	return readPhotoRasterExportBindingForProfileV1('current3', request, read, signal, sidecarEnabled);
}
export class PhotoRasterPersistedBatchCurrentV1 extends PhotoRasterPersistedBatchKernelV1 {
	private constructor(state: PhotoRasterPersistedBatchPreparedV1) { super(state); }
	static async prepare(options: PhotoRasterPersistedBatchOptionsCurrentV1): Promise<PhotoRasterPersistedBatchCurrentV1> {
		return new PhotoRasterPersistedBatchCurrentV1(await super.prepareForProfileV1('current3', options));
	}
}
