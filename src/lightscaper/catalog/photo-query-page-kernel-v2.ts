/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { assertNotAborted } from './catalog-transaction.ts';
import { PhotoQueryIndexNotReadyError } from './photo-query-index-v1.ts';
import { photoQueryRowKeyV2, photoQuerySummaryV2, readPhotoQueryRowV2, type PhotoQueryRowV2 } from './photo-query-index-v2.ts';
import { readPhotoQueryBuildStateV2 } from './photo-query-index-storage-v2.ts';
import { PHOTO_QUERY_LIMITS_V2, photoQueryDigestV2, type PhotoCatalogQueryV2, type PhotoQueryContinuationV2, type PhotoQueryPageV2 } from './photo-query-types-v2.ts';
import type { PhotoCatalogRootV1 } from './types.ts';
import type { PhotoCatalogIndexStateV1 } from './repository-types.ts';
import type { PhotoQueryInclusivePosition } from './photo-query-position.ts';

/** Trusted transaction-body scanner shared by transient and saved Query2 adapters. */
export async function readPhotoQueryPageInTransactionV2(stores: Readonly<Record<string, IDBObjectStore>>, catalog: string,
	root: PhotoCatalogRootV1, state: PhotoCatalogIndexStateV1, query: PhotoCatalogQueryV2,
	continuation: PhotoQueryContinuationV2 | null, prepareMatches: () => (row: PhotoQueryRowV2) => boolean, signal?: AbortSignal,
	position?: PhotoQueryInclusivePosition): Promise<PhotoQueryPageV2> {
	const digest = photoQueryDigestV2(query);
	const rawBuild: unknown = await request(stores.photoQueryBuildStatesV2.get(catalog));
	if (rawBuild === undefined) throw new PhotoQueryIndexNotReadyError();
	const build = readPhotoQueryBuildStateV2(rawBuild, catalog);
	if (!build.ready) throw new PhotoQueryIndexNotReadyError();
	if (build.indexedCount !== root.photoCount) throw new TypeError('Ready metadata query count disagrees with its catalog.');
	const matches = prepareMatches(), bucket = continuation?.captureBucket ?? position?.captureBucket ?? 0;
	const prefix: IDBValidKey[] = query.sort.field === 'capture-time' ? [catalog, bucket] : [catalog];
	const maximum: IDBValidKey[] = [...prefix, []], after = continuation?.afterKey ? [...continuation.afterKey] : position ? [...position.key] : null;
	const exclusive = continuation !== null || position === undefined;
	const descending = query.sort.direction === 'descending';
	const range = descending ? IDBKeyRange.bound(prefix, after ?? maximum, false, exclusive)
		: IDBKeyRange.bound(after ?? prefix, maximum, after !== null && exclusive, true);
	return new Promise<PhotoQueryPageV2>((resolve, reject) => {
		const items: PhotoQueryPageV2['items'][number][] = [];
		let scanned = 0, lastKey: readonly (string | number)[] | null = null;
		const cursor = stores.photoQueryRowsV2.index(query.sort.field).openCursor(range, descending ? 'prev' : 'next');
		const finish = (exhausted: boolean): void => {
			const nextBucket = exhausted && query.sort.field === 'capture-time' && bucket === 0;
			const next: PhotoQueryContinuationV2 | null = !exhausted || nextBucket ? Object.freeze({ schemaVersion: 2,
				kind: 'photo-query', catalogId: catalog, catalogRevision: root.revision, indexRevision: state.indexRevision,
				querySha256: digest, captureBucket: nextBucket ? 1 : bucket, afterKey: nextBucket ? null : lastKey }) : null;
			resolve(Object.freeze({ schemaVersion: 2, kind: 'photo-query-page', catalogId: catalog, catalogName: root.name,
				totalCount: root.photoCount, catalogRevision: root.revision, indexRevision: state.indexRevision,
				items: Object.freeze(items), scanned, continuation: next }));
		};
		cursor.onerror = () => reject(cursor.error ?? new Error('Could not read metadata query cursor.'));
		cursor.onsuccess = () => {
			try {
				assertNotAborted(signal);
				const current = cursor.result;
				if (!current) { finish(true); return; }
				const row = readPhotoQueryRowV2(current.value as unknown), key = photoQueryRowKeyV2(row, query.sort.field);
				if (row.catalogId !== catalog || current.primaryKey !== row.key || JSON.stringify(current.key) !== JSON.stringify(key)) {
					throw new TypeError('Metadata query cursor identity or index projection disagrees.');
				}
				scanned++; lastKey = Object.freeze(key);
				if (matches(row)) items.push(photoQuerySummaryV2(row));
				if (scanned === PHOTO_QUERY_LIMITS_V2.candidates) finish(false); else current.continue();
			} catch (error) { reject(error); }
		};
	});
}
