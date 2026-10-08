/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { assertNotAborted, catalogTransaction } from './catalog-transaction.ts';
import { readPhotoSmartCollectionSignalOptionsV1, type PhotoSmartCollectionSignalOptionsV1 } from './photo-smart-collection-repository-types-v1.ts';
import type { PhotoSmartCollectionsStateV1 } from './photo-smart-collection-state-v1.ts';
import { PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, readPhotoSmartCollectionStorageContextV1 } from './photo-smart-collection-storage-v1.ts';
import { withPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { id } from './value-validation.ts';

export interface PhotoSmartCollectionArchiveContextV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-smart-collection-archive-context';
	readonly catalogId: string;
	readonly catalogRevision: number;
	readonly indexRevision: number;
	/** Physical absence differs from a persisted empty state, including revision zero. */
	readonly state: Readonly<PhotoSmartCollectionsStateV1> | null;
}

/** Closed scalar admission completes before a repository opens its lazy database. */
export function admitPhotoSmartCollectionArchiveContextRequestV1(catalogValue: unknown, options: unknown = {}) {
	return Object.freeze({ catalogId: id(catalogValue, 'archive saved collection catalog ID'),
		...readPhotoSmartCollectionSignalOptionsV1(options) });
}

/** One readonly transaction authenticates the <=2MiB root, index, state and first paired keys.
 * One additional state key proves physical presence without retaining a second state payload.
 * No recipe inventory is captured: a later bounded audit must authenticate all rows and counts. */
export async function readPhotoSmartCollectionArchiveContextV1(database: IDBDatabase, catalogValue: string,
	options: PhotoSmartCollectionSignalOptionsV1 = {}): Promise<PhotoSmartCollectionArchiveContextV1> {
	const admitted = admitPhotoSmartCollectionArchiveContextRequestV1(catalogValue, options);
	return withPhotoStackQuerySignalV1(admitted.signal, signal => catalogTransaction(database,
		PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, 'readonly', async stores => {
			const { root, index, state } = await readPhotoSmartCollectionStorageContextV1(stores, admitted.catalogId, signal);
			const key: unknown = await request(stores.photoSmartCollectionStates.getKey(admitted.catalogId));
			assertNotAborted(signal);
			if (key !== undefined && key !== admitted.catalogId) throw new TypeError('Archive saved collection state key disagrees with its catalog.');
			if (key === undefined && (state.revision !== 0 || state.collectionCount !== 0)) {
				throw new TypeError('Archive saved collection state disappeared within its context.');
			}
			return Object.freeze({ schemaVersion: 1, kind: 'photo-smart-collection-archive-context', catalogId: admitted.catalogId,
				catalogRevision: root.revision, indexRevision: index.indexRevision, state: key === undefined ? null : state });
		}, signal));
}
