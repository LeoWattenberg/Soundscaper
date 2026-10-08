/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { assertNotAborted, catalogTransaction } from './catalog-transaction.ts';
import { withPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1 as STORES, readPhotoSmartCollectionStorageContextV1,
	readPhotoSmartCollectionSummaryRecordV1 } from './photo-smart-collection-storage-v1.ts';
import { assertPhotoSmartCollectionContextV1, readPhotoSmartCollectionPageOptionsV1, readPhotoSmartCollectionScopedKeyV1,
	PHOTO_SMART_COLLECTION_REPOSITORY_LIMITS_V1 as LIMITS, type PhotoSmartCollectionPageOptionsV1, type PhotoSmartCollectionPageV1 } from './photo-smart-collection-repository-types-v1.ts';
import { id } from './value-validation.ts';
import type { PhotoSmartCollectionSummaryV1 } from './photo-smart-collection-v1.ts';

/** One bounded scalar page. Its continuation is navigation, never publication authority. */
export async function readPhotoSmartCollectionPageV1(database: IDBDatabase, catalogId: string,
	options: PhotoSmartCollectionPageOptionsV1 = {}): Promise<PhotoSmartCollectionPageV1> {
	const catalog = id(catalogId, 'saved collection catalog ID'), admitted = readPhotoSmartCollectionPageOptionsV1(options, catalog);
	return withPhotoStackQuerySignalV1(admitted.signal, signal => catalogTransaction(database, STORES, 'readonly', async stores => {
		const context = await readPhotoSmartCollectionStorageContextV1(stores, catalog, signal);
		if (admitted.continuation) assertPhotoSmartCollectionContextV1(context, admitted.continuation);
		const prefix = JSON.stringify([catalog]).slice(0, -1) + ',';
		const range = IDBKeyRange.bound(admitted.continuation?.afterKey ?? prefix, prefix + '\uffff', admitted.continuation !== null, true);
		const items: PhotoSmartCollectionSummaryV1[] = []; let lastKey: string | null = null, bytes = 2;
		await new Promise<void>((resolve, reject) => {
			const cursor = stores.photoSmartCollectionSummaries.openCursor(range);
			cursor.onerror = () => reject(cursor.error ?? new Error('Could not page saved collection summaries.'));
			cursor.onsuccess = () => {
				const current = cursor.result;
				if (!current) { resolve(); return; }
				void visit(current).catch(reject);
			};
			async function visit(current: IDBCursorWithValue): Promise<void> {
				assertNotAborted(signal);
				const key = readPhotoSmartCollectionScopedKeyV1(current.primaryKey, catalog);
				if (lastKey !== null && key <= lastKey) throw new TypeError('Saved collection summary page keys are not ordered.');
				const summary = readPhotoSmartCollectionSummaryRecordV1(current.value, catalog, key);
				if (await request(stores.photoSmartCollections.getKey(key)) !== key) throw new TypeError('Saved collection summary has an orphan definition.');
				assertNotAborted(signal);
				bytes += new TextEncoder().encode(JSON.stringify(summary)).byteLength + (items.length === 0 ? 0 : 1);
				if (bytes > LIMITS.maximumPageBytes) throw new RangeError('Saved collection summary page exceeds its byte budget.');
				items.push(summary); lastKey = key;
				if (items.length === LIMITS.maximumPageItems) resolve(); else current.continue();
			}
		});
		const continuation = items.length === LIMITS.maximumPageItems && lastKey !== null ? Object.freeze({ schemaVersion: 1 as const,
			kind: 'photo-smart-collection-page' as const, scope: 'smart-collections' as const, catalogId: catalog,
			catalogRevision: context.root.revision, indexRevision: context.index.indexRevision, stateRevision: context.state.revision, afterKey: lastKey }) : null;
		return Object.freeze({ items: Object.freeze(items), continuation });
	}, signal));
}
