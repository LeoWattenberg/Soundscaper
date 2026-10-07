/* SPDX-License-Identifier: AGPL-3.0-only */

import { photoSummary, readPhotoSummary } from './repository-records.ts';
import type { PhotoSummaryV1 } from './repository-types.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoDocumentV1 } from './types.ts';
import { field, id, integer, record, text, uniqueIds } from './value-validation.ts';
import { PHOTO_QUERY_LIMITS_V1, type PhotoCatalogQueryV1 } from './photo-query-types-v1.ts';
import { request } from '../../common/editor/storage/indexeddb-backend.ts';

export interface PhotoQueryRowV1 {
	readonly schemaVersion: 1;
	readonly key: string;
	readonly catalogId: string;
	readonly photoId: string;
	readonly summary: PhotoSummaryV1;
	readonly title: string;
	readonly caption: string;
	readonly creator: string;
	readonly location: string;
	readonly keywordIds: readonly string[];
	readonly collectionIds: readonly string[];
	readonly fileNameSort: string;
	readonly captureBucket: 0 | 1;
	readonly captureSort: string;
	readonly ratingSort: number;
}
export const PHOTO_QUERY_INDEXES_V1 = Object.freeze({
	'photo-id': ['catalogId', 'photoId'], 'file-name': ['catalogId', 'fileNameSort', 'photoId'],
	'capture-time': ['catalogId', 'captureBucket', 'captureSort', 'photoId'], 'rating': ['catalogId', 'ratingSort', 'photoId'],
});

export function projectPhotoQueryRowV1(photo: PhotoDocumentV1): PhotoQueryRowV1 {
	const summary = photoSummary(photo);
	return readPhotoQueryRowV1({ schemaVersion: 1, key: summary.key, catalogId: summary.catalogId, photoId: summary.photoId, summary,
		title: photo.metadata.title, caption: photo.metadata.caption, creator: photo.metadata.creator, location: photo.metadata.location,
		keywordIds: photo.keywordIds, collectionIds: photo.collectionIds, fileNameSort: summary.fileName.toLowerCase(),
		captureBucket: summary.captureLocal === null ? 1 : 0, captureSort: summary.captureLocal ?? '', ratingSort: summary.rating });
}

export function readPhotoQueryRowV1(value: unknown): PhotoQueryRowV1 {
	const input = record(value, 'photo query row', ['schemaVersion', 'key', 'catalogId', 'photoId', 'summary', 'title', 'caption', 'creator', 'location', 'keywordIds', 'collectionIds', 'fileNameSort', 'captureBucket', 'captureSort', 'ratingSort']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported or future photo query row version.');
	const summary = readPhotoSummary(field(input, 'summary'));
	if (field(input, 'key') !== summary.key || field(input, 'catalogId') !== summary.catalogId || field(input, 'photoId') !== summary.photoId
		|| field(input, 'fileNameSort') !== summary.fileName.toLowerCase() || field(input, 'ratingSort') !== summary.rating
		|| field(input, 'captureBucket') !== (summary.captureLocal === null ? 1 : 0) || field(input, 'captureSort') !== (summary.captureLocal ?? '')) throw new TypeError('Photo query row projection disagrees with its summary.');
	const row = Object.freeze({ schemaVersion: 1 as const, key: summary.key, catalogId: summary.catalogId, photoId: summary.photoId, summary,
		title: text(field(input, 'title'), 'query title'), caption: text(field(input, 'caption'), 'query caption', 16_384, 0, true),
		creator: text(field(input, 'creator'), 'query creator'), location: text(field(input, 'location'), 'query location'),
		keywordIds: uniqueIds(field(input, 'keywordIds'), 'query keywords', LIGHTSCAPER_CATALOG_LIMITS.maximumMemberships),
		collectionIds: uniqueIds(field(input, 'collectionIds'), 'query collections', LIGHTSCAPER_CATALOG_LIMITS.maximumMemberships),
		fileNameSort: summary.fileName.toLowerCase(), captureBucket: (summary.captureLocal === null ? 1 : 0) as 0 | 1,
		captureSort: summary.captureLocal ?? '', ratingSort: summary.rating });
	if (new TextEncoder().encode(JSON.stringify(row)).byteLength > PHOTO_QUERY_LIMITS_V1.maximumRowBytes) throw new RangeError('Photo query row exceeds its byte budget.');
	return row;
}

export function photoQueryRowKeyV1(row: PhotoQueryRowV1, sort: PhotoCatalogQueryV1['sort']['field']): (string | number)[] {
	switch (sort) {
		case 'photo-id': return [row.catalogId, row.photoId];
		case 'file-name': return [row.catalogId, row.fileNameSort, row.photoId];
		case 'capture-time': return [row.catalogId, row.captureBucket, row.captureSort, row.photoId];
		case 'rating': return [row.catalogId, row.ratingSort, row.photoId];
	}
}

export interface PhotoQueryBuildStateV1 { readonly id: string; readonly schemaVersion: 1; readonly ready: boolean; readonly afterKey: string | null; readonly indexedCount: number }
export function readPhotoQueryBuildStateV1(value: unknown, catalog: string): PhotoQueryBuildStateV1 {
	const input = record(value, 'photo query build state', ['id', 'schemaVersion', 'ready', 'afterKey', 'indexedCount']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported or future photo query build version.');
	if (id(field(input, 'id'), 'query build catalog') !== catalog || typeof field(input, 'ready') !== 'boolean') throw new TypeError('Invalid photo query build state.');
	const after = field(input, 'afterKey');
	if (after !== null) {
		if (typeof after !== 'string' || !after.startsWith(`${catalog}|`)) throw new TypeError('Query build cursor belongs to another catalog.');
		id(after.slice(catalog.length + 1), 'query build photo');
	}
	return Object.freeze({ id: catalog, schemaVersion: 1, ready: field(input, 'ready') as boolean, afterKey: after as string | null,
		indexedCount: integer(field(input, 'indexedCount'), 0, LIGHTSCAPER_CATALOG_LIMITS.maximumPhotos, 'indexed photo count') });
}

/** Point reads and row/count writes share the caller's publication or rebuild transaction. */
export async function publishPhotoQueryRowV1(stores: Readonly<Record<string, IDBObjectStore>>, row: PhotoQueryRowV1): Promise<void> {
	const rawBuild: unknown = await request(stores.photoQueryBuildStates.get(row.catalogId));
	const build = rawBuild === undefined ? { id: row.catalogId, schemaVersion: 1 as const, ready: false, afterKey: null, indexedCount: 0 }
		: readPhotoQueryBuildStateV1(rawBuild, row.catalogId);
	const previous: unknown = await request(stores.photoQueryRows.getKey(row.key));
	if (previous !== undefined && rawBuild === undefined) throw new TypeError('Existing query rows require a consistent build state.');
	await request(stores.photoQueryRows.put(row));
	if (previous === undefined) await request(stores.photoQueryBuildStates.put(readPhotoQueryBuildStateV1({ ...build, indexedCount: build.indexedCount + 1 }, row.catalogId)));
}
export class PhotoQueryIndexNotReadyError extends Error {
	readonly code = 'PHOTO_QUERY_INDEX_NOT_READY';
	constructor() { super('The photo query index is not ready; resume its bounded rebuild.'); this.name = 'PhotoQueryIndexNotReadyError'; }
}

export function photoQueryBuildProgressV1(processed: number, bytes: number, ready: boolean) {
	return Object.freeze({ processed: integer(processed, 0, PHOTO_QUERY_LIMITS_V1.rebuildPhotos, 'rebuilt photos'),
		bytes: integer(bytes, 0, PHOTO_QUERY_LIMITS_V1.rebuildBytes, 'rebuilt bytes'), ready });
}
