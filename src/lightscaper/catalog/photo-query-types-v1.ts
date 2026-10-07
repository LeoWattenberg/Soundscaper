/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { filterScope } from './repository-records.ts';
import type { PhotoCatalogFilterV1, PhotoSummaryV1 } from './repository-types.ts';
import { array, field, id, integer, localTimestamp, oneOf, record, text } from './value-validation.ts';

export const PHOTO_QUERY_LIMITS_V1 = Object.freeze({ candidates: 64, maximumRowBytes: 524_288,
	maximumContinuationBytes: 2_048, rebuildPhotos: 16, rebuildBytes: 8_388_608 });
export const PHOTO_QUERY_SORT_FIELDS_V1 = ['photo-id', 'file-name', 'capture-time', 'rating'] as const;
export interface PhotoCatalogQueryV1 {
	readonly text: string;
	readonly filter: PhotoCatalogFilterV1 | null;
	readonly sort: Readonly<{ field: typeof PHOTO_QUERY_SORT_FIELDS_V1[number]; direction: 'ascending' | 'descending' }>;
}
export interface PhotoQueryContinuationV1 {
	readonly schemaVersion: 1;
	readonly catalogId: string;
	readonly indexRevision: number;
	readonly querySha256: string;
	readonly captureBucket: 0 | 1;
	readonly afterKey: readonly (string | number)[] | null;
}
export interface PhotoQueryPageV1 {
	readonly items: readonly PhotoSummaryV1[];
	readonly scanned: number;
	readonly continuation: PhotoQueryContinuationV1 | null;
}
export interface PhotoQueryPageRequestV1 {
	readonly query?: unknown;
	readonly continuation?: unknown;
	readonly signal?: AbortSignal;
}

export function normalizePhotoCatalogQueryV1(value: unknown = {}): PhotoCatalogQueryV1 {
	const input = record(value, 'photo catalog query', ['text', 'filter', 'sort'], []);
	const sortValue = Object.hasOwn(input, 'sort') ? field(input, 'sort') : undefined;
	const sort = sortValue === undefined ? { field: 'photo-id', direction: 'ascending' } : record(sortValue, 'photo query sort', ['field', 'direction']);
	const filterValue = Object.hasOwn(input, 'filter') ? field(input, 'filter') : undefined;
	let filter: PhotoCatalogFilterV1 | null = null;
	if (filterValue !== undefined && filterValue !== null) {
		const scope = filterScope('validation', filterValue as PhotoCatalogFilterV1).split('|');
		const kind = scope[1]; const value = scope[2]!;
		if (kind === 'folder' || kind === 'keyword' || kind === 'collection') filter = Object.freeze({ kind, id: value });
		else if (kind === 'rating') filter = Object.freeze({ kind, value: Number(value) });
		else if (kind === 'flag') filter = Object.freeze({ kind, value: oneOf(value, ['pick', 'reject', 'unflagged'] as const, 'query flag') });
		else filter = Object.freeze({ kind: 'label', value: oneOf(value, ['none', 'red', 'yellow', 'green', 'blue', 'purple'] as const, 'query label') });
	}
	const search = text(Object.hasOwn(input, 'text') ? field(input, 'text') : '', 'photo query text', 256).toLowerCase();
	return Object.freeze({ text: text(search, 'folded photo query text', 256), filter,
		sort: Object.freeze({ field: oneOf(field(sort, 'field'), PHOTO_QUERY_SORT_FIELDS_V1, 'photo query sort field'),
			direction: oneOf(field(sort, 'direction'), ['ascending', 'descending'] as const, 'photo query direction') }) });
}

export function photoQueryDigestV1(query: PhotoCatalogQueryV1): string {
	return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(query))));
}

export function readPhotoQueryContinuationV1(value: unknown, catalog: string, query: PhotoCatalogQueryV1): PhotoQueryContinuationV1 {
	const input = record(value, 'photo query continuation', ['schemaVersion', 'catalogId', 'indexRevision', 'querySha256', 'captureBucket', 'afterKey']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported or future query continuation version.');
	if (field(input, 'catalogId') !== catalog || field(input, 'querySha256') !== photoQueryDigestV1(query)) throw new TypeError('Query continuation belongs to another catalog or query.');
	const bucket = integer(field(input, 'captureBucket'), 0, 1, 'capture bucket') as 0 | 1;
	if (query.sort.field !== 'capture-time' && bucket !== 0) throw new TypeError('Query continuation has an invalid capture bucket.');
	const afterValue = field(input, 'afterKey');
	let afterKey: readonly (string | number)[] | null = null;
	if (afterValue !== null) {
		const length = query.sort.field === 'photo-id' ? 2 : query.sort.field === 'capture-time' ? 4 : 3;
		const parts = array(afterValue, 'query continuation key', length, length);
		if (parts[0] !== catalog) throw new TypeError('Query continuation key belongs to another catalog.');
		const photo = id(parts.at(-1), 'continuation photo ID');
		if (query.sort.field === 'photo-id') afterKey = Object.freeze([catalog, photo]);
		else if (query.sort.field === 'rating') afterKey = Object.freeze([catalog, integer(parts[1], 0, 5, 'continuation rating'), photo]);
		else if (query.sort.field === 'file-name') afterKey = Object.freeze([catalog, text(parts[1], 'continuation filename', 512), photo]);
		else {
			if (parts[1] !== bucket) throw new TypeError('Query continuation capture bucket disagrees.');
			const capture = bucket === 0 ? localTimestamp(parts[2], 'continuation capture') : parts[2];
			if (bucket === 1 && capture !== '') throw new TypeError('Unknown capture continuation cannot invent a date.');
			afterKey = Object.freeze([catalog, bucket, capture as string, photo]);
		}
	}
	const result = Object.freeze({ schemaVersion: 1 as const, catalogId: catalog,
		indexRevision: integer(field(input, 'indexRevision'), 0, Number.MAX_SAFE_INTEGER, 'query index revision'),
		querySha256: photoQueryDigestV1(query), captureBucket: bucket, afterKey });
	if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PHOTO_QUERY_LIMITS_V1.maximumContinuationBytes) throw new RangeError('Query continuation exceeds its byte budget.');
	return result;
}
