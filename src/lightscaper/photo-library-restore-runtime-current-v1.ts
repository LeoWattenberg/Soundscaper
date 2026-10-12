/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoLibraryRestoreRuntimeForProfileV1, type PhotoLibraryRestoreRuntimeOptionsV2 } from './internal/photo-library-restore-runtime-kernel-v1.ts';
export type PhotoLibraryRestoreRuntimeOptionsCurrentV1 = PhotoLibraryRestoreRuntimeOptionsV2;
export function createPhotoLibraryRestoreRuntimeCurrentV1(options: PhotoLibraryRestoreRuntimeOptionsCurrentV1) {
	return createPhotoLibraryRestoreRuntimeForProfileV1('current3', options);
}
