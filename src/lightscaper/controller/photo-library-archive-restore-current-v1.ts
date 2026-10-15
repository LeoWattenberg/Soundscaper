/* SPDX-License-Identifier: AGPL-3.0-only */

import { restorePhotoLibraryArchiveForProfileV1, type PhotoLibraryArchiveRestoreOptionsV2 } from './internal/photo-library-archive-restore-kernel-v1.ts';
import type { ScapeProjectInput } from '../../common/editor/scape-project-input.ts';
export type PhotoLibraryArchiveRestoreOptionsCurrentV1 = PhotoLibraryArchiveRestoreOptionsV2;
/** Whole Current archive metadata and native custody settle before pointer publication. */
export function restorePhotoLibraryArchiveCurrentV1(input: ScapeProjectInput, options: PhotoLibraryArchiveRestoreOptionsCurrentV1) {
	return restorePhotoLibraryArchiveForProfileV1('current4', input, options);
}
