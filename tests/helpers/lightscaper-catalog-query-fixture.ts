/* SPDX-License-Identifier: AGPL-3.0-only */

import { defaultPhotoDevelopV1 } from '../../src/lightscaper/catalog/develop-state.ts';
import { emptyPhotoMetadataV1 } from '../../src/lightscaper/catalog/photo-metadata.ts';
import { normalizePhotoDocumentV1 } from '../../src/lightscaper/catalog/photo-document.ts';
import { normalizePhotoCatalogRootV1 } from '../../src/lightscaper/catalog/catalog-root.ts';
import { projectPhotoQueryRowV1, type PhotoQueryRowV1 } from '../../src/lightscaper/catalog/photo-query-index-v1.ts';

export function queryCatalogRootV1() {
	return normalizePhotoCatalogRootV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo-catalog',
		id: 'catalog', name: 'Query fixture', revision: 0, photoCount: 0,
		folders: [{ id: 'folder', name: 'Folder', parentId: null }],
		keywords: [{ id: 'keyword', name: 'Landscape', parentId: null }],
		collections: [{ id: 'manual', name: 'Manual', kind: 'manual' },
			{ id: 'smart', name: 'Smart', kind: 'smart', query: { kind: 'all', terms: [
				{ kind: 'rating', minimum: 4, maximum: 5 }, { kind: 'keyword', id: 'keyword' },
				{ kind: 'not', term: { kind: 'flag', value: 'reject' } },
			] } }],
	});
}

export function queryPhotoV1(index = 0) {
	const id = `photo-${String(index).padStart(6, '0')}`;
	const fileName = `Image-${String(100_000 - index).padStart(6, '0')}.jpg`;
	return normalizePhotoDocumentV1({ schemaFamily: 'lightscaper', schemaVersion: 1, kind: 'photo',
		id, catalogId: 'catalog', revision: 0,
		original: { schemaVersion: 1, kind: 'still', id: `source-${index}`, name: fileName,
			mimeType: 'image/jpeg', storageKey: `original-${index}`, contentSha256: 'a'.repeat(64),
			width: 100, height: 50, hasAlpha: false, byteLength: 123, retention: 'managed' },
		metadata: { ...emptyPhotoMetadataV1(fileName), title: index % 997 === 0 ? 'Sparse needle' : 'Ordinary',
			captureTime: index % 3 === 0 ? null : { local: `2026-01-${String(1 + index % 28).padStart(2, '0')}T12:00:00.000`, offsetMinutes: null } },
		folderId: 'folder', collectionIds: ['manual'], keywordIds: index % 2 === 0 ? ['keyword'] : [],
		rating: index % 6, flag: 'unflagged', colorLabel: 'none', activeVersionId: 'master',
		versions: [{ id: 'master', kind: 'master', name: 'Original', createdAt: '2026-01-01T00:00:00.000Z', develop: defaultPhotoDevelopV1() }],
	});
}

const queryRowTemplate = projectPhotoQueryRowV1(queryPhotoV1());
/** Qualification setup varies one validated projection; production queries are measured unchanged. */
export function queryScaleFixtureRowV1(index: number): PhotoQueryRowV1 {
	const photoId = `photo-${String(index).padStart(6, '0')}`;
	const key = `catalog|${photoId}`;
	const fileName = `Image-${String(100_000 - index).padStart(6, '0')}.jpg`;
	const captureLocal = index % 3 === 0 ? null : `2026-01-${String(1 + index % 28).padStart(2, '0')}T12:00:00.000`;
	const rating = index % 6;
	return { ...queryRowTemplate, key, photoId, summary: { ...queryRowTemplate.summary, key, photoId, fileName, captureLocal, rating },
		title: index % 997 === 0 ? 'Sparse needle' : 'Ordinary', keywordIds: index % 2 === 0 ? ['keyword'] : [],
		fileNameSort: fileName.toLowerCase(), captureBucket: captureLocal === null ? 1 : 0, captureSort: captureLocal ?? '', ratingSort: rating };
}
