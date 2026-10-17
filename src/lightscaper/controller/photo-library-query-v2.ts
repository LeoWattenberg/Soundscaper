/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryQueryStepV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import type { PhotoLibraryQueryBuildProgressV2 } from '../../common/editor/photo-library-query-port-v2.ts';
import { photoQueryBuildProgressV2 } from '../catalog/photo-query-index-storage-v2.ts';
import { normalizePhotoCatalogQueryV2, PHOTO_QUERY_LIMITS_V2, readPhotoQueryContinuationV2,
	type PhotoCatalogQueryV2, type PhotoQueryPageRequestV2 } from '../catalog/photo-query-types-v2.ts';
import { readPhotoSummary } from '../catalog/repository-records.ts';
import { assertPhotoStackQuerySignalV1, withPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../catalog/types.ts';
import { array, field, id, integer, name, record } from '../catalog/value-validation.ts';

export interface PhotoLibraryMetadataQueryRepositoryV2 {
	readQueryPageV2(catalogId: string, options: PhotoQueryPageRequestV2): Promise<unknown>;
	rebuildQueryIndexPageV2(catalogId: string, options?: Readonly<{ signal?: AbortSignal }>): Promise<unknown>;
}
export interface PhotoLibraryMetadataQueryRequestV2 {
	readonly query: PhotoCatalogQueryV2;
	readonly cursor: string | null;
	readonly signal?: AbortSignal;
}

/** Closed admission runs before the session acquires a catalog or database. */
export function admitPhotoLibraryQueryStepRequestV2(value: unknown = {}): PhotoLibraryMetadataQueryRequestV2 {
	const input = record(value, 'metadata library query request', ['query', 'cursor', 'signal'], []);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const query = normalizePhotoCatalogQueryV2(Object.hasOwn(input, 'query') ? field(input, 'query') : undefined);
	const raw = Object.hasOwn(input, 'cursor') ? field(input, 'cursor') : null;
	let cursor: string | null = null;
	if (raw !== null && raw !== undefined) {
		if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > PHOTO_QUERY_LIMITS_V2.maximumContinuationBytes) {
			throw new RangeError('Metadata library cursor exceeds its scalar byte bound.');
		}
		const parsed: unknown = JSON.parse(raw);
		const identity = record(parsed, 'metadata cursor identity', ['schemaVersion', 'kind', 'catalogId', 'catalogRevision',
			'indexRevision', 'querySha256', 'captureBucket', 'afterKey']);
		cursor = JSON.stringify(readPhotoQueryContinuationV2(parsed, id(field(identity, 'catalogId'), 'cursor catalog ID'), query));
	}
	return Object.freeze({ query, cursor, ...(signal === undefined ? {} : { signal }) });
}

export function admitPhotoLibraryQueryBuildRequestV2(value: unknown = {}): Readonly<{ signal?: AbortSignal }> {
	const input = record(value, 'metadata query build request', ['signal'], []);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	return Object.freeze(signal === undefined ? {} : { signal });
}

/** The root context and scalar rows come from one repository transaction. */
export async function readPhotoLibraryQueryStepV2(repository: Pick<PhotoLibraryMetadataQueryRepositoryV2, 'readQueryPageV2'>,
	catalogValue: string, value: unknown = {}): Promise<PhotoLibraryQueryStepV1> {
	const catalogId = id(catalogValue, 'metadata library catalog ID'), admitted = admitPhotoLibraryQueryStepRequestV2(value);
	const continuation = admitted.cursor === null ? null : readPhotoQueryContinuationV2(JSON.parse(admitted.cursor) as unknown, catalogId, admitted.query);
	return withPhotoStackQuerySignalV1(admitted.signal, async signal => {
		const page = record(await repository.readQueryPageV2(catalogId, { query: admitted.query, continuation, signal }),
			'metadata library query page', ['schemaVersion', 'kind', 'catalogId', 'catalogName', 'totalCount',
				'catalogRevision', 'indexRevision', 'items', 'scanned', 'continuation']);
		if (field(page, 'schemaVersion') !== 2 || field(page, 'kind') !== 'photo-query-page') throw new RangeError('Unsupported metadata query page version or kind.');
		if (id(field(page, 'catalogId'), 'page catalog ID') !== catalogId) throw new TypeError('Metadata query page belongs to another catalog.');
		const catalogRevision = integer(field(page, 'catalogRevision'), 0, Number.MAX_SAFE_INTEGER, 'page catalog revision');
		const indexRevision = integer(field(page, 'indexRevision'), 0, Number.MAX_SAFE_INTEGER, 'page index revision');
		if (continuation !== null && (continuation.catalogRevision !== catalogRevision || continuation.indexRevision !== indexRevision)) {
			throw new TypeError('Metadata query page disagrees with its incoming continuation revisions.');
		}
		const totalCount = integer(field(page, 'totalCount'), 0, LIGHTSCAPER_CATALOG_LIMITS.maximumPhotos, 'page catalog count');
		const scanned = integer(field(page, 'scanned'), 0, PHOTO_QUERY_LIMITS_V2.candidates, 'page candidate count');
		const summaries = array(field(page, 'items'), 'metadata library summaries', 0, PHOTO_QUERY_LIMITS_V2.candidates).map(readPhotoSummary);
		if (summaries.length > scanned || scanned > totalCount || new Set(summaries.map(row => row.photoId)).size !== summaries.length
			|| summaries.some(row => row.catalogId !== catalogId)) throw new TypeError('Metadata query rows disagree with their catalog or candidate count.');
		const raw = field(page, 'continuation'), next = raw === null ? null : readPhotoQueryContinuationV2(raw, catalogId, admitted.query);
		if (next !== null && (next.catalogRevision !== catalogRevision || next.indexRevision !== indexRevision)) {
			throw new TypeError('Metadata query continuation disagrees with its atomic page revisions.');
		}
		return Object.freeze({ catalogName: name(field(page, 'catalogName'), 'metadata catalog name'), totalCount, scanned,
			rows: Object.freeze(summaries.map(row => Object.freeze({ id: row.photoId, fileName: row.fileName, width: row.width, height: row.height,
				rating: row.rating, flag: row.flag, colorLabel: row.colorLabel }))), cursor: next === null ? null : JSON.stringify(next) });
	});
}

/** One explicit 16-photo step; both serialized owners share the existing 8 MiB budget. */
export async function rebuildPhotoLibraryQueryStepV2(repository: Pick<PhotoLibraryMetadataQueryRepositoryV2, 'rebuildQueryIndexPageV2'>,
	catalogValue: string, value: unknown = {}): Promise<PhotoLibraryQueryBuildProgressV2> {
	const catalogId = id(catalogValue, 'metadata build catalog ID'), admitted = admitPhotoLibraryQueryBuildRequestV2(value);
	return withPhotoStackQuerySignalV1(admitted.signal, async signal => {
		const input = record(await repository.rebuildQueryIndexPageV2(catalogId, { signal }),
			'metadata library build progress', ['processed', 'bytes', 'derivedBytes', 'ready']);
		const progress = photoQueryBuildProgressV2(field(input, 'processed') as number, field(input, 'bytes') as number,
			field(input, 'derivedBytes') as number, field(input, 'ready') as boolean);
		return Object.freeze({ processed: progress.processed, readBytes: progress.bytes, writtenBytes: progress.derivedBytes, ready: progress.ready });
	});
}
