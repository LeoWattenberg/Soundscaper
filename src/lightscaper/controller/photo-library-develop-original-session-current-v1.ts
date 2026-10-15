/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopOriginalPortV1 } from '../../common/editor/photo-library-develop-original-port-v1.ts';
import type { PhotoCatalogRepositoryCurrentV1 } from '../catalog/photo-catalog-repository-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { createPhotoLibraryDevelopOriginalSessionCore, type PhotoLibraryDevelopOriginalSessionHostCore } from './photo-library-develop-original-session-core.ts';
import { admitPhotoOriginalFrameBindingCurrentV1, withPhotoOriginalFrameCurrentV1 } from '../preview/photo-original-frame-current-v1.ts';
import { capturePhotoOriginalBindingCurrentV1 } from '../preview/photo-original-binding-current-v1.ts';

export interface PhotoLibraryDevelopOriginalSessionHostCurrentV1 extends PhotoLibraryDevelopOriginalSessionHostCore {
	readonly repository: Pick<PhotoCatalogRepositoryCurrentV1, 'loadPhoto'>;
}
/** Fully admit the current Photo before projecting its immutable original identity. */
export function createPhotoLibraryDevelopOriginalSessionCurrentV1(host: PhotoLibraryDevelopOriginalSessionHostCurrentV1): Readonly<PhotoLibraryDevelopOriginalPortV1> {
	return createPhotoLibraryDevelopOriginalSessionCore(host, normalizePhotoDocumentCurrentV1,
		withPhotoOriginalFrameCurrentV1, admitPhotoOriginalFrameBindingCurrentV1, capturePhotoOriginalBindingCurrentV1);
}
