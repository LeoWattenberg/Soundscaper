/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { normalizePhotoCatalogQueryV1, photoQueryDigestV1, readPhotoQueryContinuationV1 } from './photo-query-types-v1.ts';
import type { PhotoCatalogQueryV1 } from './photo-query-types-v1.ts';
import { normalizePhotoSmartQueryV2 } from './photo-smart-query-v2.ts';
import { assertPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import type { PhotoPredicateV2 } from './photo-smart-query-types-v2.ts';
import type { PhotoSummaryV1 } from './repository-types.ts';
import { field, id, integer, record } from './value-validation.ts';

/** Successor bounds; the V1 query and derived-row profiles stay unchanged. */
export const PHOTO_QUERY_LIMITS_V2 = Object.freeze({ candidates: 64, maximumQueryBytes: 524_288,
	maximumContinuationBytes: 4_096, rebuildPhotos: 16, rebuildBytes: 8_388_608 });

export interface PhotoCatalogQueryV2 extends PhotoCatalogQueryV1 {
	readonly schemaVersion: 2;
	readonly kind: 'photo-catalog-query';
	readonly predicate: PhotoPredicateV2 | null;
}

export interface PhotoQueryContinuationV2 {
	readonly schemaVersion: 2;
	readonly kind: 'photo-query';
	readonly catalogId: string;
	readonly catalogRevision: number;
	readonly indexRevision: number;
	readonly querySha256: string;
	readonly captureBucket: 0 | 1;
	readonly afterKey: readonly (string | number)[] | null;
}

export interface PhotoQueryPageV2 {
	readonly schemaVersion: 2;
	readonly kind: 'photo-query-page';
	readonly catalogId: string;
	readonly catalogName: string;
	readonly totalCount: number;
	readonly catalogRevision: number;
	readonly indexRevision: number;
	readonly items: readonly PhotoSummaryV1[];
	readonly scanned: number;
	readonly continuation: PhotoQueryContinuationV2 | null;
}

export interface PhotoQueryPageRequestV2 {
	readonly query?: unknown;
	readonly continuation?: unknown;
	readonly signal?: AbortSignal;
}

export interface AdmittedPhotoQueryPageRequestV2 {
	readonly query: PhotoCatalogQueryV2;
	readonly continuation: PhotoQueryContinuationV2 | null;
	readonly signal?: AbortSignal;
}

/** Admission is independent of database acquisition and never invokes caller accessors. */
export function admitPhotoQueryPageRequestV2(catalogId: string, value: unknown = {}): AdmittedPhotoQueryPageRequestV2 {
	const catalog = id(catalogId, 'query catalog ID');
	const input = record(value, 'photo query page V2 request', ['query', 'continuation', 'signal'], []);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const query = normalizePhotoCatalogQueryV2(Object.hasOwn(input, 'query') ? field(input, 'query') : undefined);
	const next = Object.hasOwn(input, 'continuation') ? field(input, 'continuation') : null;
	const continuation = next === null || next === undefined ? null : readPhotoQueryContinuationV2(next, catalog, query);
	return Object.freeze({ query, continuation, ...(signal === undefined ? {} : { signal }) });
}

export function normalizePhotoCatalogQueryV2(value: unknown = { schemaVersion: 2, kind: 'photo-catalog-query' }): PhotoCatalogQueryV2 {
	const input = record(value, 'photo catalog query V2', ['schemaVersion', 'kind', 'text', 'filter', 'sort', 'predicate'], ['schemaVersion', 'kind']);
	if (field(input, 'schemaVersion') !== 2) throw new RangeError('Unsupported or future photo catalog query version.');
	if (field(input, 'kind') !== 'photo-catalog-query') throw new TypeError('Photo catalog query V2 requires its own kind.');
	const base = normalizePhotoCatalogQueryV1({
		...(Object.hasOwn(input, 'text') ? { text: field(input, 'text') } : {}),
		...(Object.hasOwn(input, 'filter') ? { filter: field(input, 'filter') } : {}),
		...(Object.hasOwn(input, 'sort') ? { sort: field(input, 'sort') } : {}),
	});
	const candidate = Object.hasOwn(input, 'predicate') ? field(input, 'predicate') : null;
	const predicate = candidate === null ? null : normalizePhotoSmartQueryV2({ schemaVersion: 2,
		kind: 'photo-smart-query', predicate: candidate }).predicate;
	const query = Object.freeze({ schemaVersion: 2 as const, kind: 'photo-catalog-query' as const,
		text: base.text, filter: base.filter, sort: base.sort, predicate });
	if (new TextEncoder().encode(JSON.stringify(query)).byteLength > PHOTO_QUERY_LIMITS_V2.maximumQueryBytes) {
		throw new RangeError('Photo catalog query V2 exceeds its byte budget.');
	}
	return query;
}

/** Explicit opt-in preserves the V1 text universe, filter, ordering and defaults. */
export function migratePhotoCatalogQueryV1ToV2(value: unknown = {}): PhotoCatalogQueryV2 {
	const base = normalizePhotoCatalogQueryV1(value);
	return Object.freeze({ schemaVersion: 2, kind: 'photo-catalog-query', text: base.text,
		filter: base.filter, sort: base.sort, predicate: null });
}

export function serializePhotoCatalogQueryV2(value: unknown): string {
	return JSON.stringify(normalizePhotoCatalogQueryV2(value));
}

export function photoQueryDigestV2(query: PhotoCatalogQueryV2): string {
	return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(query))));
}

/** The existing key grammar remains bounded; V2 identity and revisions are separate. */
export function readPhotoQueryContinuationV2(value: unknown, catalogId: string, query: PhotoCatalogQueryV2): PhotoQueryContinuationV2 {
	const catalog = id(catalogId, 'query catalog ID');
	const input = record(value, 'photo query V2 continuation', ['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'indexRevision', 'querySha256', 'captureBucket', 'afterKey']);
	if (field(input, 'schemaVersion') !== 2) throw new RangeError('Unsupported or future photo query continuation version.');
	if (field(input, 'kind') !== 'photo-query') throw new TypeError('Photo query continuation has a foreign kind.');
	if (field(input, 'catalogId') !== catalog || field(input, 'querySha256') !== photoQueryDigestV2(query)) {
		throw new TypeError('Query continuation belongs to another catalog or query.');
	}
	const base: PhotoCatalogQueryV1 = { text: query.text, filter: query.filter, sort: query.sort };
	const key = readPhotoQueryContinuationV1({ schemaVersion: 1, catalogId: catalog,
		indexRevision: field(input, 'indexRevision'), querySha256: photoQueryDigestV1(base),
		captureBucket: field(input, 'captureBucket'), afterKey: field(input, 'afterKey') }, catalog, base);
	const continuation = Object.freeze({ schemaVersion: 2 as const, kind: 'photo-query' as const, catalogId: catalog,
		catalogRevision: integer(field(input, 'catalogRevision'), 0, Number.MAX_SAFE_INTEGER, 'query catalog revision'),
		indexRevision: key.indexRevision, querySha256: photoQueryDigestV2(query), captureBucket: key.captureBucket, afterKey: key.afterKey });
	if (new TextEncoder().encode(JSON.stringify(continuation)).byteLength > PHOTO_QUERY_LIMITS_V2.maximumContinuationBytes) {
		throw new RangeError('Photo query continuation V2 exceeds its byte budget.');
	}
	return continuation;
}
