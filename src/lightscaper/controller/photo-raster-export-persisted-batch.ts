/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryExportSidecarRequest, ReadPhotoExportSidecar } from '../../common/editor/photo-library-session-port-v2.ts';
import type { PhotoRasterExportBindingV1 } from '../storage/photo-raster-export-journal-v1.ts';
import { PhotoRasterPersistedBatchKernelV1, readPhotoRasterExportBindingForProfileV1,
	type PhotoRasterPersistedBatchOptionsV1, type PhotoRasterPersistedBatchPreparedV1 } from './internal/photo-raster-export-persisted-batch-kernel-v1.ts';

export function readPhotoRasterExportBinding(request: Readonly<PhotoLibraryExportSidecarRequest>, read: ReadPhotoExportSidecar, signal: AbortSignal, sidecarEnabled = false): Promise<Readonly<PhotoRasterExportBindingV1>> {
	return readPhotoRasterExportBindingForProfileV1('legacy2', request, read, signal, sidecarEnabled);
}
export class PhotoRasterPersistedBatch extends PhotoRasterPersistedBatchKernelV1 {
	private constructor(state: PhotoRasterPersistedBatchPreparedV1) { super(state); }
	static async prepare(options: PhotoRasterPersistedBatchOptionsV1): Promise<PhotoRasterPersistedBatch> {
		return new PhotoRasterPersistedBatch(await super.prepareForProfileV1('legacy2', options));
	}
}
