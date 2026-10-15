/* SPDX-License-Identifier: AGPL-3.0-only */

import { readMediaRestoreCatalogPageForProfileV1 } from './photo-media-restore-read-v2.ts';
import type { PhotoLibraryRestoreAllocationV1 } from './photo-library-restore-ownership-v1.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import type { PhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
export function readMediaRestoreCatalogPageCurrentV1(database: IDBDatabase, allocation: PhotoLibraryRestoreAllocationV1,
	root: PhotoCatalogRootV1, afterKey: string | null, signal: AbortSignal, visit?: (photo: PhotoDocumentCurrentV1) => void) {
	return readMediaRestoreCatalogPageForProfileV1('current4', database, allocation, root, afterKey, signal, visit);
}
