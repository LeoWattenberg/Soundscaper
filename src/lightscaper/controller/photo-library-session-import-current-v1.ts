/* SPDX-License-Identifier: AGPL-3.0-only */

import { createPhotoLibrarySessionImportForProfileV1, type PhotoLibrarySessionImportHostCurrentV1 } from './internal/photo-library-session-import-kernel-v1.ts';
export type { PhotoLibrarySessionImportHostCurrentV1 } from './internal/photo-library-session-import-kernel-v1.ts';

/** Named Current import shares the existing Original custody, ACK and writer. */
export function createPhotoLibrarySessionImportCurrentV1(host: PhotoLibrarySessionImportHostCurrentV1) {
	return createPhotoLibrarySessionImportForProfileV1('current3', host);
}
