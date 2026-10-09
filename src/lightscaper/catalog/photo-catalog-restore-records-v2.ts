/* SPDX-License-Identifier: AGPL-3.0-only */

import { readValidatedPhotoCatalogRootV1 } from './documents.ts';
import { normalizePhotoDocumentV1OrV2, type PhotoDocumentV2 } from './photo-document-v2.ts';
import { validatePhotoCatalogReferencesV1 } from './photo-document.ts';
import { photoMemberships, photoStorageKey, photoSummary } from './repository-records.ts';
import type { PhotoMembershipV1, PhotoSummaryV1 } from './repository-types.ts';
import type { PhotoDocumentV1 } from './types.ts';
import { projectPhotoQueryRowV1, type PhotoQueryRowV1 } from './photo-query-index-v1.ts';
import { projectPhotoQueryRowV2, type PhotoQueryRowV2 } from './photo-query-index-v2.ts';

export { photoCatalogRestoreRootRecordsV1, photoCatalogRestoreStackRecordsV1, photoCatalogRestoreSavedCollectionRecordsV1,
	type PhotoCatalogRestoreRootRecordsV1 } from './photo-catalog-restore-records-v1.ts';

export interface PhotoCatalogRestorePhotoRecordsV2 {
	readonly photo: Readonly<{ key: string; document: PhotoDocumentV1 | PhotoDocumentV2 }>;
	readonly summary: PhotoSummaryV1;
	readonly memberships: readonly PhotoMembershipV1[];
	readonly queryV1: PhotoQueryRowV1 | null;
	readonly queryV2: PhotoQueryRowV2;
}

/** Complete mixed document admission precedes the unchanged metadata-only projections.
 * One serial source and its independently bounded projections are retained; no whole-heap bound. */
export function photoCatalogRestorePhotoRecordsV2(rootValue: unknown, value: unknown): PhotoCatalogRestorePhotoRecordsV2 {
	const root = readValidatedPhotoCatalogRootV1(rootValue), document = normalizePhotoDocumentV1OrV2(value);
	validatePhotoCatalogReferencesV1(document, root);
	let queryV1: PhotoQueryRowV1 | null;
	try { queryV1 = projectPhotoQueryRowV1(document); }
	catch (error) {
		if (!(error instanceof RangeError) || error.message !== 'Photo query row exceeds its byte budget.') throw error;
		queryV1 = null;
	}
	return Object.freeze({ photo: Object.freeze({ key: photoStorageKey(root.id, document.id), document }),
		summary: photoSummary(document), memberships: photoMemberships(document), queryV1, queryV2: projectPhotoQueryRowV2(document) });
}
