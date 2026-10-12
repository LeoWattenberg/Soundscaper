/* SPDX-License-Identifier: AGPL-3.0-only */

import { restorePhotoLibraryArchiveForProfileV1, type PhotoLibraryArchiveRestoreOptionsV2 } from './internal/photo-library-archive-restore-kernel-v1.ts';
import type { ScapeProjectInput } from '../../common/editor/scape-project-input.ts';
export type { PhotoLibraryArchiveRestoreOptionsV2 } from './internal/photo-library-archive-restore-kernel-v1.ts';
/** Permanent legacy archive admission; full Photo3 and Row3 remain refused. */
export function restorePhotoLibraryArchiveV2(input: ScapeProjectInput, options: PhotoLibraryArchiveRestoreOptionsV2) {
	return restorePhotoLibraryArchiveForProfileV1('legacy2', input, options);
}
