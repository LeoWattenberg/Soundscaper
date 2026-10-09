/* SPDX-License-Identifier: AGPL-3.0-only */

import { matchesNormalizedPhotoQuerySubjectV1, type PhotoQuerySubjectV1 } from './smart-query.ts';
import type { PhotoCatalogRootV1 } from './types.ts';
import type { PhotoCatalogQueryV1 } from './photo-query-types-v1.ts';
import type { PhotoQueryRowV1 } from './photo-query-index-v1.ts';

/** Trusted matcher input; full stored-row admission remains the scanner's responsibility. */
export type PhotoQueryMatchRowV1 = Pick<PhotoQueryRowV1, 'title' | 'caption' | 'creator' | 'location' | 'keywordIds' | 'collectionIds'>
	& Readonly<{ summary: Omit<PhotoQuerySubjectV1, 'keywordIds'> }>;

export function photoQueryMatcherV1(root: PhotoCatalogRootV1, query: PhotoCatalogQueryV1): (row: PhotoQueryMatchRowV1) => boolean {
	const filter = query.filter;
	const keywords = new Map(root.keywords.map((node) => [node.id, node.name]));
	const collection = filter?.kind === 'collection' ? root.collections.find((candidate) => candidate.id === filter.id) : null;
	if (filter?.kind === 'collection' && !collection || filter?.kind === 'keyword' && !keywords.has(filter.id)
		|| filter?.kind === 'folder' && !root.folders.some((node) => node.id === filter.id)) throw new ReferenceError('Photo query references a missing catalog definition.');
	return (row) => {
		const summary = row.summary;
		if (filter) {
			switch (filter.kind) {
				case 'rating': if (summary.rating !== filter.value) return false; break;
				case 'flag': if (summary.flag !== filter.value) return false; break;
				case 'label': if (summary.colorLabel !== filter.value) return false; break;
				case 'folder': if (summary.folderId !== filter.id) return false; break;
				case 'keyword': if (!row.keywordIds.includes(filter.id)) return false; break;
				case 'collection':
					if (collection!.kind === 'manual') { if (!row.collectionIds.includes(filter.id)) return false; }
					else if (!matchesNormalizedPhotoQuerySubjectV1({ ...summary, keywordIds: row.keywordIds }, collection!.query)) return false;
					break;
			}
		}
		return query.text === '' || [summary.fileName, row.title, row.caption, row.creator, row.location].some((value) => value.toLowerCase().includes(query.text))
			|| row.keywordIds.some((keyword) => keywords.get(keyword)?.toLowerCase().includes(query.text));
	};
}
