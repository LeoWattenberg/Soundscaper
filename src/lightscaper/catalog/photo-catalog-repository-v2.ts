/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCatalogRepositoryKernelV2 } from './photo-catalog-repository-kernel-v2.ts';
import type { PhotoCatalogRepositoryOptionsV1 } from './repository-types.ts';
import type { PhotoDocumentV1 } from './types.ts';
import type { PhotoDocumentV2 } from './photo-document-v2.ts';

type LegacyPhoto = PhotoDocumentV1 | PhotoDocumentV2;
export interface PhotoCatalogRepositoryOptionsV2 extends PhotoCatalogRepositoryOptionsV1 {
	/** Bound to immutable selected-library bodies before native writes. */
	readonly verifyResources?: (photo: LegacyPhoto, signal?: AbortSignal) => Promise<void>;
}

/** Fixed strict Photo1/2 frontdoor; no read silently promotes a document. */
export class PhotoCatalogRepositoryV2 extends PhotoCatalogRepositoryKernelV2 {
	constructor(options: PhotoCatalogRepositoryOptionsV2) { super(options, 'legacy2'); }
	override async loadPhoto(catalogId: string, photoId: string): Promise<LegacyPhoto | null> {
		const photo = await super.loadPhoto(catalogId, photoId);
		if (photo?.schemaVersion === 3) throw new RangeError('Unsupported legacy Photo document version.');
		return photo;
	}
	override async savePhoto(value: unknown, expectedRevision: number, options: Readonly<{ signal?: AbortSignal }> = {}): Promise<LegacyPhoto> {
		const photo = await super.savePhoto(value, expectedRevision, options);
		if (photo.schemaVersion === 3) throw new RangeError('Unsupported legacy Photo document version.');
		return photo;
	}
}
