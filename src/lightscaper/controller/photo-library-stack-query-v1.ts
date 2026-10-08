/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryQueryStepV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import { PHOTO_STACK_QUERY_LIMITS_V1, admitPhotoStackQueryPageRequestV1, readPhotoStackQueryContinuationV1 } from '../catalog/photo-stack-query-types-v1.ts';
import { normalizePhotoCatalogQueryV1 } from '../catalog/photo-query-types-v1.ts';
import { readPhotoSummary } from '../catalog/repository-records.ts';
import type { PhotoCatalogRepositoryV1 } from '../catalog/repository.ts';
import { withPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { array, field, id, integer, name, record } from '../catalog/value-validation.ts';

export function admitPhotoLibraryStackQueryStepV1(value: unknown) {
	const input = record(value, 'collapsed library query request', ['query', 'cursor', 'signal'], ['query']);
	const query = normalizePhotoCatalogQueryV1(field(input, 'query'));
	const raw = Object.hasOwn(input, 'cursor') ? field(input, 'cursor') : null;
	if (raw !== null && raw !== undefined && (typeof raw !== 'string'
		|| new TextEncoder().encode(raw).byteLength > PHOTO_STACK_QUERY_LIMITS_V1.maximumContinuationBytes)) throw new RangeError('Collapsed library query cursor exceeds its scalar byte bound.');
	const parsed: unknown = raw === null || raw === undefined ? null : JSON.parse(raw as string);
	const catalogId = parsed === null ? 'admission' : id(field(record(parsed, 'collapsed cursor identity',
		['schemaVersion', 'kind', 'catalogId', 'catalogRevision', 'indexRevision', 'stateRevision', 'querySha256', 'captureBucket', 'afterKey', 'pending', 'stackAudit', 'progressSha256']), 'catalogId'), 'cursor catalog ID');
	const request = admitPhotoStackQueryPageRequestV1(catalogId, { query, continuation: parsed,
		...(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal') } : {}) });
	return Object.freeze({ query: request.query, cursor: request.continuation === null ? null : JSON.stringify(request.continuation),
		...(request.signal ? { signal: request.signal } : {}) });
}

export async function readPhotoLibraryStackQueryStepV1(repository: Pick<PhotoCatalogRepositoryV1, 'readStackQueryPage'>,
	catalogValue: string, value: unknown): Promise<PhotoLibraryQueryStepV1> {
	const catalogId = id(catalogValue, 'collapsed library catalog ID'), admitted = admitPhotoLibraryStackQueryStepV1(value);
	const continuation = admitted.cursor === null ? null : readPhotoStackQueryContinuationV1(JSON.parse(admitted.cursor) as unknown, catalogId, admitted.query);
	return withPhotoStackQuerySignalV1(admitted.signal, async signal => {
		const page = record(await repository.readStackQueryPage(catalogId, { query: admitted.query, continuation, signal }),
			'collapsed library query page', ['catalogName', 'totalCount', 'items', 'scanned', 'continuation']);
		const rows = array(field(page, 'items'), 'collapsed library rows', 0, PHOTO_STACK_QUERY_LIMITS_V1.candidates).map(readPhotoSummary);
		if (rows.some(row => row.catalogId !== catalogId)) throw new TypeError('Collapsed library row belongs to another catalog.');
		const raw = field(page, 'continuation');
		const next = raw === null ? null : readPhotoStackQueryContinuationV1(raw, catalogId, admitted.query);
		return Object.freeze({ catalogName: name(field(page, 'catalogName'), 'collapsed catalog name'),
			totalCount: integer(field(page, 'totalCount'), 0, Number.MAX_SAFE_INTEGER, 'collapsed catalog count'),
			scanned: integer(field(page, 'scanned'), 0, PHOTO_STACK_QUERY_LIMITS_V1.candidates, 'collapsed candidate count'),
			rows: Object.freeze(rows.map(row => Object.freeze({ id: row.photoId, fileName: row.fileName, width: row.width, height: row.height,
				rating: row.rating, flag: row.flag, colorLabel: row.colorLabel }))), cursor: next === null ? null : JSON.stringify(next) });
	});
}
