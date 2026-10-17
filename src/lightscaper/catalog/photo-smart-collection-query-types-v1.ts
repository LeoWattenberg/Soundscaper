/* SPDX-License-Identifier: AGPL-3.0-only */

import { readPhotoQueryPosition } from './photo-query-position.ts';
import { PHOTO_QUERY_SORT_FIELDS_V1, type PhotoCatalogQueryV1 } from './photo-query-types-v1.ts';
import { assertPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { PHOTO_STACK_LIMITS_V1 } from './photo-stack-v1.ts';
import type { PhotoStackQueryPendingV1, PhotoStackQueryAuditV1 } from './photo-stack-query-types-v1.ts';
import type { PhotoSummaryV1 } from './repository-types.ts';
import { field, id, integer, oneOf, record } from './value-validation.ts';

export const PHOTO_SAVED_QUERY_LIMITS_V1 = Object.freeze({ candidates: 64, maximumContinuationBytes: 4096,
	maximumDefinitionBytes: 528384, maximumPrivateRecordBytes: 603424, maximumCompiledPredicateBytes: 524288 });
export type PhotoSavedQueryModeV1 = 'ordinary' | 'collapsed';
export interface PhotoSavedQueryContinuationV1 {
	readonly schemaVersion: 1;
	readonly kind: 'saved-photo-query';
	readonly mode: PhotoSavedQueryModeV1;
	readonly catalogId: string;
	readonly collectionId: string;
	readonly definitionRevision: number;
	readonly collectionStateRevision: number;
	readonly definitionSha256: string;
	readonly querySha256: string;
	readonly catalogRevision: number;
	readonly indexRevision: number;
	readonly sort: PhotoCatalogQueryV1['sort'];
	readonly captureBucket: 0 | 1;
	readonly afterKey: readonly (string | number)[] | null;
	readonly stackStateRevision: number | null;
	readonly pending: PhotoStackQueryPendingV1 | null;
	readonly stackAudit: PhotoStackQueryAuditV1 | null;
	readonly progressSha256: string;
}
export interface PhotoSavedQueryPageV1 {
	readonly schemaVersion: 1;
	readonly kind: 'saved-photo-query-page';
	readonly mode: PhotoSavedQueryModeV1;
	readonly catalogId: string;
	readonly catalogName: string;
	readonly totalCount: number;
	readonly catalogRevision: number;
	readonly indexRevision: number;
	readonly collectionId: string;
	readonly collectionName: string;
	readonly definitionRevision: number;
	readonly collectionStateRevision: number;
	readonly definitionSha256: string;
	readonly querySha256: string;
	readonly stackStateRevision: number | null;
	readonly items: readonly PhotoSummaryV1[];
	readonly scanned: number;
	readonly continuation: PhotoSavedQueryContinuationV1 | null;
}
export interface PhotoSavedQueryPageRequestV1 { readonly continuation?: unknown; readonly signal?: AbortSignal }

export function readPhotoSavedQueryContinuationV1(value: unknown, catalogValue: string, collectionValue: string,
	mode: PhotoSavedQueryModeV1): PhotoSavedQueryContinuationV1 {
	const catalogId = id(catalogValue, 'saved query catalog ID'), collectionId = id(collectionValue, 'saved query collection ID');
	const input = record(value, 'saved query continuation', ['schemaVersion', 'kind', 'mode', 'catalogId', 'collectionId',
		'definitionRevision', 'collectionStateRevision', 'definitionSha256', 'querySha256', 'catalogRevision', 'indexRevision',
		'sort', 'captureBucket', 'afterKey', 'stackStateRevision', 'pending', 'stackAudit', 'progressSha256']);
	if (field(input, 'schemaVersion') !== 1 || field(input, 'kind') !== 'saved-photo-query') throw new RangeError('Unsupported saved query continuation.');
	if (field(input, 'catalogId') !== catalogId || field(input, 'collectionId') !== collectionId || field(input, 'mode') !== mode) {
		throw new TypeError('Saved query continuation belongs to another selection or mode.');
	}
	const rawSort = record(field(input, 'sort'), 'saved query sort', ['field', 'direction']);
	const sort = Object.freeze({ field: oneOf(field(rawSort, 'field'), PHOTO_QUERY_SORT_FIELDS_V1, 'saved query sort field'),
		direction: oneOf(field(rawSort, 'direction'), ['ascending', 'descending'] as const, 'saved query direction') });
	const position = readPhotoQueryPosition({ captureBucket: field(input, 'captureBucket'), afterKey: field(input, 'afterKey') }, catalogId, sort.field);
	const rawPending = field(input, 'pending'); let pending: PhotoStackQueryPendingV1 | null = null;
	if (rawPending !== null) {
		const p = record(rawPending, 'saved collapsed member progress', ['photoId', 'stackId', 'stackRevision', 'nextMember']);
		pending = Object.freeze({ photoId: id(field(p, 'photoId'), 'pending photo ID'), stackId: id(field(p, 'stackId'), 'pending stack ID'),
			stackRevision: revision(field(p, 'stackRevision')), nextMember: integer(field(p, 'nextMember'), 0, PHOTO_STACK_LIMITS_V1.maximumPhotos, 'pending member position') });
		if (position.afterKey?.at(-1) !== pending.photoId) throw new TypeError('Saved pending photo differs from its seek position.');
	}
	const rawAudit = field(input, 'stackAudit'); let stackAudit: PhotoStackQueryAuditV1 | null = null;
	if (rawAudit !== null) {
		const a = record(rawAudit, 'saved stack audit progress', ['afterKey', 'count']), key = field(a, 'afterKey'), prefix = `${catalogId}|`;
		if (typeof key !== 'string' || key !== prefix + id(key.slice(prefix.length), 'audited stack ID') || pending !== null || position.afterKey !== null) {
			throw new TypeError('Saved stack audit differs from its seek position.');
		}
		stackAudit = Object.freeze({ afterKey: key, count: integer(field(a, 'count'), 1, Number.MAX_SAFE_INTEGER, 'audited stack count') });
	}
	const rawState = field(input, 'stackStateRevision'), stackStateRevision = rawState === null ? null : revision(rawState);
	if (mode === 'ordinary' ? stackStateRevision !== null || pending !== null || stackAudit !== null : stackStateRevision === null) {
		throw new TypeError('Saved query grouping progress has another mode.');
	}
	const result: PhotoSavedQueryContinuationV1 = Object.freeze({ schemaVersion: 1, kind: 'saved-photo-query', mode, catalogId, collectionId,
		definitionRevision: revision(field(input, 'definitionRevision')), collectionStateRevision: revision(field(input, 'collectionStateRevision')),
		definitionSha256: digest(field(input, 'definitionSha256')), querySha256: digest(field(input, 'querySha256')),
		catalogRevision: revision(field(input, 'catalogRevision')), indexRevision: revision(field(input, 'indexRevision')),
		sort, ...position, stackStateRevision, pending, stackAudit, progressSha256: digest(field(input, 'progressSha256')) });
	if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PHOTO_SAVED_QUERY_LIMITS_V1.maximumContinuationBytes) throw new RangeError('Saved query continuation exceeds its byte budget.');
	return result;
}

/** Selection, closed scalar progress and native signal detach before lazy database acquisition. */
export function admitPhotoSavedQueryPageRequestV1(catalogValue: string, collectionValue: string, mode: PhotoSavedQueryModeV1, value: unknown = {}) {
	const catalogId = id(catalogValue, 'saved query catalog ID'), collectionId = id(collectionValue, 'saved query collection ID');
	const input = record(value, 'saved query page request', ['continuation', 'signal'], []);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const raw = Object.hasOwn(input, 'continuation') ? field(input, 'continuation') : null;
	const continuation = raw === null ? null : readPhotoSavedQueryContinuationV1(raw, catalogId, collectionId, mode);
	return Object.freeze({ catalogId, collectionId, mode, continuation, ...(signal === undefined ? {} : { signal }) });
}
function revision(value: unknown): number {
	if (Object.is(value, -0)) throw new TypeError('Saved query revision must be a canonical nonnegative integer.');
	return integer(value, 0, Number.MAX_SAFE_INTEGER, 'saved query revision');
}
function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Saved query digest requires SHA-256.');
	return value;
}
