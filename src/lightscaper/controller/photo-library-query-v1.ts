/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryQueryBuildProgressV1, PhotoLibraryQueryStepV1, PhotoLibraryQueryV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import { validateLightscaperDocumentV1 } from '../catalog/documents.ts';
import { normalizePhotoCatalogQueryV1, PHOTO_QUERY_LIMITS_V1, readPhotoQueryContinuationV1 } from '../catalog/photo-query-types-v1.ts';
import type { PhotoCatalogRepositoryV1 } from '../catalog/repository.ts';
import { field, id, record } from '../catalog/value-validation.ts';

const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;

interface QueryRequest {
	readonly query: PhotoLibraryQueryV1;
	readonly cursor: string | null;
	readonly signal?: AbortSignal;
}

/** Admission precedes session initialization; actual catalog binding follows acquisition. */
export function admitPhotoLibraryQueryStepRequestV1(value: unknown = {}): Readonly<QueryRequest> {
	const input = record(value, 'photo library query request', ['query', 'cursor', 'signal'], []);
	const query = normalizePhotoCatalogQueryV1(Object.hasOwn(input, 'query') ? field(input, 'query') : undefined);
	const cursorValue = Object.hasOwn(input, 'cursor') ? field(input, 'cursor') : null;
	let cursor: string | null = null;
	if (cursorValue !== null && cursorValue !== undefined) {
		if (typeof cursorValue !== 'string' || new TextEncoder().encode(cursorValue).byteLength > PHOTO_QUERY_LIMITS_V1.maximumContinuationBytes) {
			throw new RangeError('Photo query cursor exceeds its scalar byte bound.');
		}
		const parsed: unknown = JSON.parse(cursorValue);
		const candidate = record(parsed, 'photo query cursor', ['schemaVersion', 'catalogId', 'indexRevision', 'querySha256', 'captureBucket', 'afterKey']);
		readPhotoQueryContinuationV1(candidate, id(field(candidate, 'catalogId'), 'cursor catalog ID'), query);
		cursor = cursorValue;
	}
	return Object.freeze({ query, cursor, ...admitSignal(input) });
}

export function admitPhotoLibraryQueryBuildRequestV1(value: unknown = {}): Readonly<{ signal?: AbortSignal }> {
	return Object.freeze(admitSignal(record(value, 'photo query build request', ['signal'], [])));
}

/** One sparse candidate page; composition owns yielding and draining empty nonterminal steps. */
export async function readPhotoLibraryQueryStepV1(
	repository: Pick<PhotoCatalogRepositoryV1, 'loadCatalog' | 'readQueryPage'>, catalogId: string, request: unknown = {},
): Promise<PhotoLibraryQueryStepV1> {
	const catalog = id(catalogId, 'catalog ID'), admitted = admitPhotoLibraryQueryStepRequestV1(request);
	const continuation = admitted.cursor === null ? null : readPhotoQueryContinuationV1(JSON.parse(admitted.cursor) as unknown, catalog, admitted.query);
	const value = await repository.loadCatalog(catalog); checkSignal(admitted.signal);
	const root = validateLightscaperDocumentV1(value);
	if (root.kind !== 'photo-catalog' || root.id !== catalog) throw new TypeError('Photo query requires the selected catalog root.');
	const page = await repository.readQueryPage(catalog, { query: admitted.query, continuation, signal: admitted.signal });
	checkSignal(admitted.signal);
	return Object.freeze({ catalogName: root.name, totalCount: root.photoCount, scanned: page.scanned,
		rows: Object.freeze(page.items.map(row => Object.freeze({ id: row.photoId, fileName: row.fileName, rating: row.rating,
			flag: row.flag, colorLabel: row.colorLabel, width: row.width, height: row.height }))),
		cursor: page.continuation === null ? null : JSON.stringify(readPhotoQueryContinuationV1(page.continuation, catalog, admitted.query)) });
}

/** No implicit rebuild loop: each call persists at most the repository's 16-document/8 MiB step. */
export async function rebuildPhotoLibraryQueryStepV1(
	repository: Pick<PhotoCatalogRepositoryV1, 'rebuildQueryIndexPage'>, catalogId: string, options: unknown = {},
): Promise<PhotoLibraryQueryBuildProgressV1> {
	const catalog = id(catalogId, 'catalog ID'), admitted = admitPhotoLibraryQueryBuildRequestV1(options);
	const progress = await repository.rebuildQueryIndexPage(catalog, admitted); checkSignal(admitted.signal);
	return Object.freeze({ processed: progress.processed, readBytes: progress.bytes, ready: progress.ready });
}

function admitSignal(input: Readonly<Record<string, unknown>>): { signal?: AbortSignal } {
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal === undefined) return {};
	if (!(signal instanceof AbortSignal)) throw new TypeError('Photo query requires a native cancellation signal.');
	checkSignal(signal);
	return { signal };
}

function checkSignal(signal?: AbortSignal): void {
	if (!signal) return;
	Reflect.apply(nativeThrowIfAborted, signal, []);
	if (Object.getPrototypeOf(signal) !== AbortSignal.prototype
		|| ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener'].some(key => Object.hasOwn(signal, key))) {
		throw new TypeError('Photo query requires native signal behavior without overrides.');
	}
}
