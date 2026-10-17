/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoCatalogQueryV1, readPhotoQueryContinuationV1, type PhotoCatalogQueryV1 } from './photo-query-types-v1.ts';
import type { PhotoSummaryV1 } from './repository-types.ts';
import { field, id, integer, record } from './value-validation.ts';
import { PHOTO_STACK_LIMITS_V1 } from './photo-stack-v1.ts';
import { assertPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';

export const PHOTO_STACK_QUERY_LIMITS_V1 = Object.freeze({ candidates: 64, maximumContinuationBytes: 4_096 });
export interface PhotoStackQueryPendingV1 {
	readonly photoId: string;
	readonly stackId: string;
	readonly stackRevision: number;
	readonly nextMember: number;
}
export interface PhotoStackQueryAuditV1 { readonly afterKey: string; readonly count: number }
export interface PhotoStackQueryContinuationV1 {
	readonly schemaVersion: 1;
	readonly kind: 'collapsed-photo-query';
	readonly catalogId: string;
	readonly catalogRevision: number;
	readonly indexRevision: number;
	readonly stateRevision: number;
	readonly querySha256: string;
	readonly captureBucket: 0 | 1;
	readonly afterKey: readonly (string | number)[] | null;
	readonly pending: PhotoStackQueryPendingV1 | null;
	readonly stackAudit: PhotoStackQueryAuditV1 | null;
	readonly progressSha256: string;
}
export interface PhotoStackQueryPageV1 {
	readonly catalogName: string;
	readonly totalCount: number;
	readonly items: readonly PhotoSummaryV1[];
	readonly scanned: number;
	readonly continuation: PhotoStackQueryContinuationV1 | null;
}
export interface PhotoStackQueryPageRequestV1 { readonly query?: unknown; readonly continuation?: unknown; readonly signal?: AbortSignal }
export interface PhotoStackQueryAdmittedV1 {
	readonly query: PhotoCatalogQueryV1;
	readonly continuation: PhotoStackQueryContinuationV1 | null;
	readonly signal?: AbortSignal;
}

export function readPhotoStackQueryContinuationV1(value: unknown, catalogId: string, query: PhotoCatalogQueryV1): PhotoStackQueryContinuationV1 {
	const input = record(value, 'collapsed query continuation', ['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'indexRevision',
		'stateRevision', 'querySha256', 'captureBucket', 'afterKey', 'pending', 'stackAudit', 'progressSha256']);
	if (field(input, 'kind') !== 'collapsed-photo-query') throw new TypeError('Collapsed query continuation has another kind.');
	const base = readPhotoQueryContinuationV1({ schemaVersion: field(input, 'schemaVersion'), catalogId: field(input, 'catalogId'),
		indexRevision: field(input, 'indexRevision'), querySha256: field(input, 'querySha256'), captureBucket: field(input, 'captureBucket'),
		afterKey: field(input, 'afterKey') }, catalogId, query);
	const raw = field(input, 'pending'); let pending: PhotoStackQueryPendingV1 | null = null;
	if (raw !== null) {
		const probe = record(raw, 'collapsed query pending probe', ['photoId', 'stackId', 'stackRevision', 'nextMember']);
		pending = Object.freeze({ photoId: id(field(probe, 'photoId'), 'pending photo ID'), stackId: id(field(probe, 'stackId'), 'pending stack ID'),
			stackRevision: integer(field(probe, 'stackRevision'), 0, Number.MAX_SAFE_INTEGER, 'pending stack revision'),
			nextMember: integer(field(probe, 'nextMember'), 0, PHOTO_STACK_LIMITS_V1.maximumPhotos, 'pending member position') });
		if (base.afterKey?.at(-1) !== pending.photoId) throw new TypeError('Pending query photo differs from its global position.');
	}
	const auditRaw = field(input, 'stackAudit'); let stackAudit: PhotoStackQueryAuditV1 | null = null;
	if (auditRaw !== null) {
		const audit = record(auditRaw, 'collapsed stack count audit', ['afterKey', 'count']), key = field(audit, 'afterKey'), prefix = `${catalogId}|`;
		if (typeof key !== 'string' || !key.startsWith(prefix) || key !== prefix + id(key.slice(prefix.length), 'audited stack ID')
			|| pending !== null || base.afterKey !== null) throw new TypeError('Collapsed stack count audit has another query position.');
		stackAudit = Object.freeze({ afterKey: key, count: integer(field(audit, 'count'), 1, Number.MAX_SAFE_INTEGER, 'audited stack count') });
	}
	const progressSha256 = field(input, 'progressSha256');
	if (typeof progressSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(progressSha256)) throw new TypeError('Collapsed progress signature requires SHA-256.');
	const result: PhotoStackQueryContinuationV1 = Object.freeze({ ...base, kind: 'collapsed-photo-query',
		catalogRevision: integer(field(input, 'catalogRevision'), 0, Number.MAX_SAFE_INTEGER, 'collapsed catalog revision'),
		stateRevision: integer(field(input, 'stateRevision'), 0, Number.MAX_SAFE_INTEGER, 'collapsed stack state revision'), pending, stackAudit,
		progressSha256 });
	if (new TextEncoder().encode(JSON.stringify(result)).byteLength > PHOTO_STACK_QUERY_LIMITS_V1.maximumContinuationBytes) {
		throw new RangeError('Collapsed query continuation exceeds its scalar byte budget.');
	}
	return result;
}

export function admitPhotoStackQueryPageRequestV1(catalogValue: unknown, value: unknown = {}): PhotoStackQueryAdmittedV1 {
	const catalogId = id(catalogValue, 'collapsed query catalog ID');
	const input = record(value, 'collapsed query page request', ['query', 'continuation', 'signal'], []);
	const query = normalizePhotoCatalogQueryV1(Object.hasOwn(input, 'query') ? field(input, 'query') : undefined);
	const raw = Object.hasOwn(input, 'continuation') ? field(input, 'continuation') : null;
	const continuation = raw === null || raw === undefined ? null : readPhotoStackQueryContinuationV1(raw, catalogId, query);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	return Object.freeze({ query, continuation, ...(signal === undefined ? {} : { signal }) });
}
