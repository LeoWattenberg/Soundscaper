/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDocumentV1OrV2 } from '../catalog/photo-document-v2.ts';
import type { PhotoCatalogRepositoryV2 } from '../catalog/photo-catalog-repository-v2.ts';
import { createPhotoLibraryDevelopOriginalSessionCore, type PhotoLibraryDevelopOriginalSessionHostCore } from './photo-library-develop-original-session-core.ts';

export interface PhotoLibraryDevelopOriginalSessionHostV2 extends PhotoLibraryDevelopOriginalSessionHostCore {
	readonly repository: Pick<PhotoCatalogRepositoryV2, 'loadPhoto'>;
}

/** Current original pixels retain their V1 presentation contract; recipes are fully admitted before projection. */
export function createPhotoLibraryDevelopOriginalSessionV2(host: PhotoLibraryDevelopOriginalSessionHostV2) {
	return createPhotoLibraryDevelopOriginalSessionCore(host, normalizePhotoDocumentV1OrV2);
}
