/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { assertNotAborted, catalogTransaction } from './catalog-transaction.ts';
import { validateLightscaperDocumentV1 } from './documents.ts';
import { readIndexState } from './repository-records.ts';
import { PhotoCatalogRevisionConflictError } from './repository-types.ts';
import { PhotoQueryIndexNotReadyError } from './photo-query-index-v1.ts';
import { photoQueryRowKeyV2, photoQuerySummaryV2, readPhotoQueryRowV2 } from './photo-query-index-v2.ts';
import { readPhotoQueryBuildStateV2 } from './photo-query-index-storage-v2.ts';
import { photoQueryMatcherV2 } from './photo-query-matcher-v2.ts';
import { withPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { admitPhotoQueryPageRequestV2, PHOTO_QUERY_LIMITS_V2, photoQueryDigestV2,
	type PhotoQueryContinuationV2, type PhotoQueryPageRequestV2, type PhotoQueryPageV2 } from './photo-query-types-v2.ts';
import { id } from './value-validation.ts';

/** Each native cursor step retains one admitted full row and at most64 existing scalar summaries. */
export async function readPhotoQueryPageV2(database: IDBDatabase, catalogId: string, options: PhotoQueryPageRequestV2 = {}): Promise<PhotoQueryPageV2> {
	const catalog = id(catalogId, 'query catalog ID'), admitted = admitPhotoQueryPageRequestV2(catalog, options);
	const { query, continuation } = admitted, digest = photoQueryDigestV2(query);
	return withPhotoStackQuerySignalV1(admitted.signal, signal => catalogTransaction(database,
		['catalogs', 'catalogStates', 'photoQueryRowsV2', 'photoQueryBuildStatesV2'], 'readonly', async stores => {
			const stateValue: unknown = await request(stores.catalogStates.get(catalog));
			if (stateValue === undefined) throw new ReferenceError('Photo catalog is missing.');
			const state = readIndexState(stateValue);
			const root = validateLightscaperDocumentV1(await request(stores.catalogs.get(catalog)) as unknown);
			if (root.kind !== 'photo-catalog' || state.id !== catalog || root.id !== catalog
				|| state.rootRevision !== root.revision || state.photoCount !== root.photoCount) throw new TypeError('Metadata query catalog state disagrees with its root.');
			if (continuation && (continuation.catalogRevision !== root.revision || continuation.indexRevision !== state.indexRevision)) {
				throw new PhotoCatalogRevisionConflictError('catalog');
			}
			const rawBuild: unknown = await request(stores.photoQueryBuildStatesV2.get(catalog));
			if (rawBuild === undefined) throw new PhotoQueryIndexNotReadyError();
			const build = readPhotoQueryBuildStateV2(rawBuild, catalog);
			if (!build.ready) throw new PhotoQueryIndexNotReadyError();
			if (build.indexedCount !== root.photoCount) throw new TypeError('Ready metadata query count disagrees with its catalog.');
			const matches = photoQueryMatcherV2(root, query), bucket = continuation?.captureBucket ?? 0;
			const prefix: IDBValidKey[] = query.sort.field === 'capture-time' ? [catalog, bucket] : [catalog];
			const maximum: IDBValidKey[] = [...prefix, []], after = continuation?.afterKey ? [...continuation.afterKey] : null;
			const descending = query.sort.direction === 'descending';
			const range = descending ? IDBKeyRange.bound(prefix, after ?? maximum, false, true)
				: IDBKeyRange.bound(after ?? prefix, maximum, after !== null, true);
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
		}, signal));
}
