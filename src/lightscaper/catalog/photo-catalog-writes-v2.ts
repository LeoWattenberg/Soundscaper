/* SPDX-License-Identifier: AGPL-3.0-only */

import { publishPhotosKernelV2, savePhotoKernelV2 } from './photo-catalog-writes-kernel-v2.ts';
import type { PhotoDocumentV1, PhotoCatalogRootV1 } from './types.ts';
import type { PhotoDocumentV2 } from './photo-document-v2.ts';

type LegacyPhoto = PhotoDocumentV1 | PhotoDocumentV2;
/** Fixed legacy admission; native transaction and projections are shared. */
export function publishPhotosV2(database: IDBDatabase, catalogId: string, expectedRevision: number, photos: readonly LegacyPhoto[], signal?: AbortSignal): Promise<PhotoCatalogRootV1> {
	return publishPhotosKernelV2(database, catalogId, expectedRevision, photos, 'legacy2', signal);
}
export async function savePhotoV2(database: IDBDatabase, photo: LegacyPhoto, expectedRevision: number, signal?: AbortSignal): Promise<LegacyPhoto> {
	const result = await savePhotoKernelV2(database, photo, expectedRevision, 'legacy2', signal);
	if (result.schemaVersion === 3) throw new RangeError('Unsupported legacy Photo document version.');
	return result;
}
