/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoDocumentV1 } from './types.ts';

/** Borrowed only after whole Photo1/2 admission; index rows never own Develop state. */
export type PhotoCatalogIndexSourceV1 = Pick<PhotoDocumentV1,
	'id' | 'catalogId' | 'revision' | 'metadata' | 'original' | 'folderId' | 'collectionIds'
	| 'keywordIds' | 'rating' | 'flag' | 'colorLabel' | 'activeVersionId'>;
