/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDocumentV1 } from '../catalog/photo-document.ts';
import { createPhotoLibraryDevelopOriginalSessionCore, type PhotoLibraryDevelopOriginalSessionHostCore } from './photo-library-develop-original-session-core.ts';
import type { PhotoLibrarySessionPortsV1 } from './photo-library-session-ports.ts';

export interface PhotoLibraryDevelopOriginalSessionHostV1 extends PhotoLibraryDevelopOriginalSessionHostCore {
	readonly repository: Pick<PhotoLibrarySessionPortsV1['catalog'], 'loadPhoto'>;
}

/** The named V1 reader retains its exact old document owner. */
export function createPhotoLibraryDevelopOriginalSessionV1(host: PhotoLibraryDevelopOriginalSessionHostV1) {
	return createPhotoLibraryDevelopOriginalSessionCore(host, normalizePhotoDocumentV1);
}
