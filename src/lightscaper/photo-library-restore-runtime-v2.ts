/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoLibraryRestoreRuntimeForProfileV1, type PhotoLibraryRestoreRuntimeOptionsV2 } from './internal/photo-library-restore-runtime-kernel-v1.ts';
export type { PhotoLibraryRestoreRuntimeOptionsV2 } from './internal/photo-library-restore-runtime-kernel-v1.ts';
export function createPhotoLibraryRestoreRuntimeV2(options: PhotoLibraryRestoreRuntimeOptionsV2) {
	return createPhotoLibraryRestoreRuntimeForProfileV1('legacy2', options);
}
