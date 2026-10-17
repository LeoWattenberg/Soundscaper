/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoCatalogIndexSourceV1 } from './photo-catalog-index-source-v1.ts';

import { normalizePhotoMetadataV1 } from './photo-metadata.ts';
import { photoStorageKey, readPhotoSummary } from './repository-records.ts';
import type { PhotoSummaryV1 } from './repository-types.ts';
import { LIGHTSCAPER_CATALOG_LIMITS, type PhotoMetadataV1, type PhotoFlagV1, type PhotoColorLabelV1 } from './types.ts';
import { field, oneOf, record, uniqueIds } from './value-validation.ts';

/** All five legal16384-unit texts, camera strings and both membership sets fit without truncation. */
export const PHOTO_QUERY_ROW_LIMITS_V2 = Object.freeze({ maximumRowBytes: 1_048_576 });
export const PHOTO_QUERY_INDEXES_V2 = Object.freeze({
	'photo-id': Object.freeze(['catalogId', 'photoId']),
	'file-name': Object.freeze(['catalogId', 'fileNameSort', 'photoId']),
	'capture-time': Object.freeze(['catalogId', 'captureBucket', 'captureSort', 'photoId']),
	rating: Object.freeze(['catalogId', 'ratingSort', 'photoId']),
});
export type PhotoQuerySortFieldV2 = keyof typeof PHOTO_QUERY_INDEXES_V2;

/** Effective authored metadata only. The summary is derived on demand instead of being stored twice. */
export interface PhotoQueryRowV2 extends PhotoMetadataV1 {
	readonly schemaVersion: 2;
	readonly key: string;
	readonly catalogId: string;
	readonly photoId: string;
	readonly photoRevision: number;
	readonly rating: number;
	readonly flag: PhotoFlagV1;
	readonly colorLabel: PhotoColorLabelV1;
	readonly folderId: string | null;
	readonly activeVersionId: string;
	readonly originalSha256: string;
	readonly width: number;
	readonly height: number;
	readonly keywordIds: readonly string[];
	readonly collectionIds: readonly string[];
	readonly fileNameSort: string;
	readonly captureBucket: 0 | 1;
	readonly captureSort: string;
	readonly ratingSort: number;
}

const METADATA_FIELDS = ['fileName', 'modifiedTime', 'captureTime', 'orientation', 'cameraMake', 'cameraModel', 'lens',
	'exposureSeconds', 'aperture', 'iso', 'focalLengthMm', 'title', 'caption', 'creator', 'copyright', 'location'] as const;
const FIELDS = ['schemaVersion', 'key', 'catalogId', 'photoId', 'photoRevision', ...METADATA_FIELDS, 'rating', 'flag',
	'colorLabel', 'folderId', 'activeVersionId', 'originalSha256', 'width', 'height', 'keywordIds', 'collectionIds',
	'fileNameSort', 'captureBucket', 'captureSort', 'ratingSort'];

export function projectPhotoQueryRowV2(photo: PhotoCatalogIndexSourceV1): PhotoQueryRowV2 {
	const metadata = normalizePhotoMetadataV1(photo.metadata);
	return readPhotoQueryRowV2({ schemaVersion: 2, key: photoStorageKey(photo.catalogId, photo.id), catalogId: photo.catalogId,
		photoId: photo.id, photoRevision: photo.revision, ...metadata, rating: photo.rating, flag: photo.flag,
		colorLabel: photo.colorLabel, folderId: photo.folderId, activeVersionId: photo.activeVersionId,
		originalSha256: photo.original.contentSha256, width: photo.original.width, height: photo.original.height,
		keywordIds: photo.keywordIds, collectionIds: photo.collectionIds, fileNameSort: metadata.fileName.toLowerCase(),
		captureBucket: metadata.captureTime === null ? 1 : 0, captureSort: metadata.captureTime?.local ?? '', ratingSort: photo.rating });
}

export function readPhotoQueryRowV2(value: unknown): PhotoQueryRowV2 {
	const input = record(value, 'photo query row2', FIELDS);
	if (field(input, 'schemaVersion') !== 2) throw new RangeError('Unsupported or future photo query row version.');
	const metadata = normalizePhotoMetadataV1(Object.fromEntries(METADATA_FIELDS.map(key => [key, field(input, key)])));
	const summary = readPhotoSummary({ key: field(input, 'key'), catalogId: field(input, 'catalogId'), photoId: field(input, 'photoId'),
		photoRevision: field(input, 'photoRevision'), fileName: metadata.fileName, captureLocal: metadata.captureTime?.local ?? null,
		rating: field(input, 'rating'), flag: field(input, 'flag'), colorLabel: field(input, 'colorLabel'), folderId: field(input, 'folderId'),
		activeVersionId: field(input, 'activeVersionId'), originalSha256: field(input, 'originalSha256'), width: field(input, 'width'), height: field(input, 'height') });
	const fileNameSort = metadata.fileName.toLowerCase(), captureBucket = metadata.captureTime === null ? 1 : 0;
	const captureSort = metadata.captureTime?.local ?? '';
	if (field(input, 'fileNameSort') !== fileNameSort || field(input, 'captureBucket') !== captureBucket
		|| field(input, 'captureSort') !== captureSort || field(input, 'ratingSort') !== summary.rating) {
		throw new TypeError('Photo query row2 projection disagrees with its effective metadata or summary.');
	}
	const { fileName: _fileName, captureLocal: _captureLocal, ...identity } = summary;
	const row: PhotoQueryRowV2 = Object.freeze({ schemaVersion: 2, ...identity, ...metadata,
		keywordIds: uniqueIds(field(input, 'keywordIds'), 'query2 keywords', LIGHTSCAPER_CATALOG_LIMITS.maximumMemberships),
		collectionIds: uniqueIds(field(input, 'collectionIds'), 'query2 collections', LIGHTSCAPER_CATALOG_LIMITS.maximumMemberships),
		fileNameSort, captureBucket, captureSort, ratingSort: summary.rating });
	if (new TextEncoder().encode(JSON.stringify(row)).byteLength > PHOTO_QUERY_ROW_LIMITS_V2.maximumRowBytes) {
		throw new RangeError('Photo query row2 exceeds its byte budget.');
	}
	return row;
}

/** Called with an admitted row; existing catalog page consumers keep the unchanged4KiB summary contract. */
export function photoQuerySummaryV2(row: PhotoQueryRowV2): PhotoSummaryV1 {
	return readPhotoSummary({ key: row.key, catalogId: row.catalogId, photoId: row.photoId, photoRevision: row.photoRevision,
		fileName: row.fileName, captureLocal: row.captureTime?.local ?? null, rating: row.rating, flag: row.flag,
		colorLabel: row.colorLabel, folderId: row.folderId, activeVersionId: row.activeVersionId,
		originalSha256: row.originalSha256, width: row.width, height: row.height });
}

export function photoQueryRowKeyV2(row: PhotoQueryRowV2, sort: PhotoQuerySortFieldV2): (string | number)[] {
	switch (oneOf(sort, ['photo-id', 'file-name', 'capture-time', 'rating'] as const, 'query2 sort field')) {
		case 'photo-id': return [row.catalogId, row.photoId];
		case 'file-name': return [row.catalogId, row.fileNameSort, row.photoId];
		case 'capture-time': return [row.catalogId, row.captureBucket, row.captureSort, row.photoId];
		case 'rating': return [row.catalogId, row.ratingSort, row.photoId];
	}
}
