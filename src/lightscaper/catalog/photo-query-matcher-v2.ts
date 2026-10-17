/* SPDX-License-Identifier: AGPL-3.0-only */

import { photoQueryMatcherV1 } from './photo-query-matcher-v1.ts';
import type { PhotoQueryRowV2 } from './photo-query-index-v2.ts';
import type { PhotoCatalogQueryV2 } from './photo-query-types-v2.ts';
import { compilePhotoSmartQueryV2 } from './photo-smart-query-v2.ts';
import type { PhotoCatalogRootV1 } from './types.ts';

/** Compile all references before scanning; ordinary and collapsed V2 queries share this predicate. */
export function photoQueryMatcherV2(root: PhotoCatalogRootV1, query: PhotoCatalogQueryV2): (row: PhotoQueryRowV2) => boolean {
	const legacy = photoQueryMatcherV1(root, { text: query.text, filter: query.filter, sort: query.sort });
	const metadata = query.predicate === null ? null : compilePhotoSmartQueryV2({ schemaVersion: 2,
		kind: 'photo-smart-query', predicate: query.predicate }, {
		folders: new Set(root.folders.map(node => node.id)), keywords: new Set(root.keywords.map(node => node.id)),
	});
	return row => {
		const summary = { rating: row.rating, flag: row.flag, colorLabel: row.colorLabel, folderId: row.folderId,
			fileName: row.fileName, captureLocal: row.captureTime?.local ?? null };
		if (!legacy({ summary,
			title: row.title, caption: row.caption, creator: row.creator, location: row.location,
			keywordIds: row.keywordIds, collectionIds: row.collectionIds })) return false;
		return metadata === null || metadata({ metadata: row, width: row.width, height: row.height, rating: row.rating,
			flag: row.flag, colorLabel: row.colorLabel, folderId: row.folderId, keywordIds: row.keywordIds });
	};
}
