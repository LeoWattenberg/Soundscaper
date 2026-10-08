/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryQueryStepV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import { normalizePhotoCatalogQueryV2 } from '../catalog/photo-query-types-v2.ts';
import { PHOTO_STACK_QUERY_LIMITS_V2, admitPhotoStackQueryPageRequestV2, readPhotoStackQueryContinuationV2,
	type PhotoStackQueryPageRequestV2 } from '../catalog/photo-stack-query-types-v2.ts';
import { assertPhotoStackQuerySignalV1, withPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { readPhotoSummary } from '../catalog/repository-records.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../catalog/types.ts';
import { array, field, id, integer, name, record } from '../catalog/value-validation.ts';

export interface PhotoLibraryMetadataStackQueryRepositoryV2 {
	readStackQueryPageV2(catalogId: string, options: PhotoStackQueryPageRequestV2): Promise<unknown>;
}

export function admitPhotoLibraryStackQueryStepV2(value: unknown) {
	const input = record(value, 'collapsed metadata library request', ['query', 'cursor', 'signal'], ['query']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const query = normalizePhotoCatalogQueryV2(field(input, 'query'));
	const raw = Object.hasOwn(input, 'cursor') ? field(input, 'cursor') : null;
	if (raw !== null && raw !== undefined && (typeof raw !== 'string'
		|| new TextEncoder().encode(raw).byteLength > PHOTO_STACK_QUERY_LIMITS_V2.maximumContinuationBytes)) {
		throw new RangeError('Collapsed metadata cursor exceeds its scalar byte bound.');
	}
	const parsed: unknown = raw === null || raw === undefined ? null : JSON.parse(raw as string);
	const catalogId = parsed === null ? 'admission' : id(field(record(parsed, 'collapsed metadata cursor identity',
		['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'indexRevision', 'stateRevision', 'querySha256',
			'captureBucket', 'afterKey', 'pending', 'stackAudit', 'progressSha256']), 'catalogId'), 'cursor catalog ID');
	const request = admitPhotoStackQueryPageRequestV2(catalogId, { query, continuation: parsed, ...(signal === undefined ? {} : { signal }) });
	return Object.freeze({ query: request.query, cursor: request.continuation === null ? null : JSON.stringify(request.continuation),
		...(request.signal === undefined ? {} : { signal: request.signal }) });
}

export async function readPhotoLibraryStackQueryStepV2(repository: PhotoLibraryMetadataStackQueryRepositoryV2,
	catalogValue: string, value: unknown): Promise<PhotoLibraryQueryStepV1> {
	const catalogId = id(catalogValue, 'collapsed metadata catalog ID'), admitted = admitPhotoLibraryStackQueryStepV2(value);
	const continuation = admitted.cursor === null ? null : readPhotoStackQueryContinuationV2(JSON.parse(admitted.cursor) as unknown, catalogId, admitted.query);
	return withPhotoStackQuerySignalV1(admitted.signal, async signal => {
		const page = record(await repository.readStackQueryPageV2(catalogId, { query: admitted.query, continuation, signal }),
			'collapsed metadata library page', ['schemaVersion', 'kind', 'catalogId', 'catalogName', 'totalCount', 'catalogRevision',
				'indexRevision', 'stateRevision', 'items', 'scanned', 'continuation']);
		if (field(page, 'schemaVersion') !== 2 || field(page, 'kind') !== 'collapsed-photo-query-page') throw new RangeError('Unsupported collapsed metadata page version or kind.');
		if (id(field(page, 'catalogId'), 'page catalog ID') !== catalogId) throw new TypeError('Collapsed metadata page belongs to another catalog.');
		const catalogRevision = integer(field(page, 'catalogRevision'), 0, Number.MAX_SAFE_INTEGER, 'page catalog revision');
		const indexRevision = integer(field(page, 'indexRevision'), 0, Number.MAX_SAFE_INTEGER, 'page index revision');
		const stateRevision = integer(field(page, 'stateRevision'), 0, Number.MAX_SAFE_INTEGER, 'page stack revision');
		if (continuation !== null && (continuation.catalogRevision !== catalogRevision || continuation.indexRevision !== indexRevision
			|| continuation.stateRevision !== stateRevision)) throw new TypeError('Collapsed metadata page disagrees with its incoming continuation revisions.');
		const totalCount = integer(field(page, 'totalCount'), 0, LIGHTSCAPER_CATALOG_LIMITS.maximumPhotos, 'page catalog count');
		const scanned = integer(field(page, 'scanned'), 0, PHOTO_STACK_QUERY_LIMITS_V2.candidates, 'page candidate count');
		const summaries = array(field(page, 'items'), 'collapsed metadata summaries', 0, PHOTO_STACK_QUERY_LIMITS_V2.candidates).map(readPhotoSummary);
		if (summaries.length > scanned || summaries.length > totalCount || new Set(summaries.map(row => row.photoId)).size !== summaries.length
			|| summaries.some(row => row.catalogId !== catalogId)) throw new TypeError('Collapsed metadata rows disagree with their catalog or candidate count.');
		const raw = field(page, 'continuation'), next = raw === null ? null : readPhotoStackQueryContinuationV2(raw, catalogId, admitted.query);
		if (next !== null && (next.catalogRevision !== catalogRevision || next.indexRevision !== indexRevision || next.stateRevision !== stateRevision)) {
			throw new TypeError('Collapsed metadata continuation disagrees with its page revisions.');
		}
		return Object.freeze({ catalogName: name(field(page, 'catalogName'), 'collapsed metadata catalog name'), totalCount, scanned,
			rows: Object.freeze(summaries.map(row => Object.freeze({ id: row.photoId, fileName: row.fileName, width: row.width, height: row.height,
				rating: row.rating, flag: row.flag, colorLabel: row.colorLabel }))), cursor: next === null ? null : JSON.stringify(next) });
	});
}
