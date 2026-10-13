/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoLibrarySessionImportForProfileV1, type PhotoLibrarySessionImportHostLegacyV2 } from './internal/photo-library-session-import-kernel-v1.ts';

/** Permanent Photo1/2 import admission and native publication. */
export function createPhotoLibrarySessionImport(host: PhotoLibrarySessionImportHostLegacyV2) {
	return createPhotoLibrarySessionImportForProfileV1('legacy2', host);
}
