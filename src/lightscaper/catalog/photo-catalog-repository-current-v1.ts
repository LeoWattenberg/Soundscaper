/* SPDX-License-Identifier: AGPL-3.0-only */

import { PhotoCatalogRepositoryKernelV2 } from './photo-catalog-repository-kernel-v2.ts';
import type { PhotoCatalogRepositoryOptionsV1 } from './repository-types.ts';
import type { PhotoDocumentCurrentV1 } from './photo-document-current-v1.ts';
import type { PhotoCatalogRootV1 } from './types.ts';
import type { PhotoDerivedPublicationSelectionCurrentV1 } from './photo-derived-publication-current-v1.ts';

export interface PhotoCatalogRepositoryOptionsCurrentV1 extends PhotoCatalogRepositoryOptionsV1 {
	/** Verification receives the genuine complete selected aggregate. */
	readonly verifyResources?: (photo: PhotoDocumentCurrentV1, signal?: AbortSignal) => Promise<void>;
}

/** Explicit current Photo1/2/3 authority sharing the existing native owner. */
export class PhotoCatalogRepositoryCurrentV1 extends PhotoCatalogRepositoryKernelV2 {
	constructor(options: PhotoCatalogRepositoryOptionsCurrentV1) { super(options, 'current3'); }
	publishDerivedPhotoCurrentV1(catalogId: string, expectedCatalogRevision: number,
		selections: readonly PhotoDerivedPublicationSelectionCurrentV1[], photo: unknown,
		options: Readonly<{ signal?: AbortSignal }> = {}): Promise<PhotoCatalogRootV1> {
		return this.publishDerivedPhotoForCurrentV1(catalogId, expectedCatalogRevision, selections, photo, options);
	}
}
