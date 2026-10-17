/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { assertNotAborted, catalogTransaction } from './catalog-transaction.ts';
import { validateLightscaperDocumentV1 } from './documents.ts';
import { readIndexState } from './repository-records.ts';
import { PhotoCatalogRevisionConflictError } from './repository-types.ts';
import type { PhotoCatalogRootV1 } from './types.ts';
import type { PhotoCatalogIndexStateV1 } from './repository-types.ts';
import type { PhotoQueryInclusivePosition } from './photo-query-position.ts';
import { field, id, record } from './value-validation.ts';
import { photoQueryMatcherV1 } from './photo-query-matcher-v1.ts';
import { photoQueryRowKeyV1, PhotoQueryIndexNotReadyError, readPhotoQueryBuildStateV1, readPhotoQueryRowV1 } from './photo-query-index-v1.ts';
import { normalizePhotoCatalogQueryV1, PHOTO_QUERY_LIMITS_V1, photoQueryDigestV1, readPhotoQueryContinuationV1,
	type PhotoQueryContinuationV1, type PhotoQueryPageRequestV1, type PhotoQueryPageV1, type PhotoCatalogQueryV1 } from './photo-query-types-v1.ts';

export async function readPhotoQueryPageV1(database: IDBDatabase, catalogId: string, options: PhotoQueryPageRequestV1 = {}): Promise<PhotoQueryPageV1> {
	const catalog = id(catalogId, 'query catalog');
	const input = record(options, 'photo query page request', ['query', 'continuation', 'signal'], []);
	const query = normalizePhotoCatalogQueryV1(Object.hasOwn(input, 'query') ? field(input, 'query') : undefined);
	const continuationValue = Object.hasOwn(input, 'continuation') ? field(input, 'continuation') : undefined;
	const continuation = continuationValue === undefined || continuationValue === null ? null : readPhotoQueryContinuationV1(continuationValue, catalog, query);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') as AbortSignal | undefined : undefined;
	if (signal !== undefined && !(signal instanceof AbortSignal)) throw new TypeError('Photo queries require a native cancellation signal.');
	return catalogTransaction(database, ['catalogs', 'catalogStates', 'photoQueryRows', 'photoQueryBuildStates'], 'readonly', async (stores) => {
		const stateValue: unknown = await request(stores.catalogStates.get(catalog));
		if (stateValue === undefined) throw new ReferenceError('Photo catalog is missing.');
		const state = readIndexState(stateValue);
		const root = validateLightscaperDocumentV1(await request(stores.catalogs.get(catalog)) as unknown);
		if (root.kind !== 'photo-catalog') throw new TypeError('Photo queries require a catalog root.');
		if (state.id !== catalog || root.id !== catalog || state.rootRevision !== root.revision || state.photoCount !== root.photoCount) throw new TypeError('Query catalog state disagrees with its root.');
		if (continuation && continuation.indexRevision !== state.indexRevision) throw new PhotoCatalogRevisionConflictError('catalog');
		return readPhotoQueryPageInTransactionV1(stores, catalog, root, state, query, continuation, signal);
	}, signal);
}


/** Shared native scanner; inclusive position is internal and never a continuation field. */
export async function readPhotoQueryPageInTransactionV1(stores: Readonly<Record<string, IDBObjectStore>>, catalog: string,
	root: PhotoCatalogRootV1, state: PhotoCatalogIndexStateV1, query: PhotoCatalogQueryV1, continuation: PhotoQueryContinuationV1 | null,
	signal?: AbortSignal, position?: PhotoQueryInclusivePosition): Promise<PhotoQueryPageV1> {
	const build: unknown = await request(stores.photoQueryBuildStates.get(catalog));
	if (build === undefined || !readPhotoQueryBuildStateV1(build, catalog).ready) throw new PhotoQueryIndexNotReadyError();
	if (readPhotoQueryBuildStateV1(build, catalog).indexedCount !== root.photoCount) throw new TypeError('Ready photo query count disagrees with its catalog.');
	const matches = photoQueryMatcherV1(root, query);
	const bucket = continuation?.captureBucket ?? position?.captureBucket ?? 0;
	const prefix: IDBValidKey[] = query.sort.field === 'capture-time' ? [catalog, bucket] : [catalog];
	const maximum: IDBValidKey[] = [...prefix, []];
	const after = continuation?.afterKey ? [...continuation.afterKey] : position ? [...position.key] : null;
	const exclusive = continuation !== null || position === undefined;
	const descending = query.sort.direction === 'descending';
	const range = descending ? IDBKeyRange.bound(prefix, after ?? maximum, false, exclusive)
		: IDBKeyRange.bound(after ?? prefix, maximum, after !== null && exclusive, true);
	return new Promise<PhotoQueryPageV1>((resolve, reject) => {
		const items: PhotoQueryPageV1['items'][number][] = [];
		let scanned = 0; let lastKey: readonly (string | number)[] | null = null;
		const cursor = stores.photoQueryRows.index(query.sort.field).openCursor(range, descending ? 'prev' : 'next');
		const finish = (exhausted: boolean): void => {
			const nextBucket = exhausted && query.sort.field === 'capture-time' && bucket === 0;
			const next: PhotoQueryContinuationV1 | null = !exhausted || nextBucket ? Object.freeze({ schemaVersion: 1, catalogId: catalog,
				indexRevision: state.indexRevision, querySha256: photoQueryDigestV1(query), captureBucket: nextBucket ? 1 : bucket,
				afterKey: nextBucket ? null : lastKey }) : null;
			resolve(Object.freeze({ items: Object.freeze(items), scanned, continuation: next }));
		};
		cursor.onerror = () => reject(cursor.error ?? new Error('Could not read photo query cursor.'));
		cursor.onsuccess = () => {
			try {
				assertNotAborted(signal);
				const current = cursor.result;
				if (!current) { finish(true); return; }
				const row = readPhotoQueryRowV1(current.value as unknown);
				const key = photoQueryRowKeyV1(row, query.sort.field);
				if (row.catalogId !== catalog || current.primaryKey !== row.key || JSON.stringify(current.key) !== JSON.stringify(key)) throw new TypeError('Photo query cursor identity or index projection disagrees.');
				scanned++; lastKey = Object.freeze(key);
				if (matches(row)) items.push(row.summary);
				if (scanned === PHOTO_QUERY_LIMITS_V1.candidates) finish(false);
				else current.continue();
			} catch (error) { reject(error); }
		};
	});
}
