/* SPDX-License-Identifier: AGPL-3.0-only */

import { catalogTransaction } from './catalog-transaction.ts';
import { photoSmartCollectionKeyV1 } from './photo-smart-collection-record-v1.ts';
import { readPhotoSmartCollectionDefinitionV1, validatePhotoSmartCollectionReferencesV1 } from './photo-smart-collection-read-v1.ts';
import { readPhotoSmartCollectionSignalOptionsV1, type PhotoSmartCollectionSignalOptionsV1 } from './photo-smart-collection-repository-types-v1.ts';
import { PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, readPhotoSmartCollectionStorageContextV1 } from './photo-smart-collection-storage-v1.ts';
import type { PhotoSmartCollectionV1 } from './photo-smart-collection-v1.ts';
import { withPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { id } from './value-validation.ts';

export interface PhotoSmartCollectionSnapshotContextV1 {
	readonly catalogId: string;
	readonly catalogRevision: number;
	readonly indexRevision: number;
	readonly collectionStateRevision: number;
	readonly collectionCount: number;
}
export interface PhotoSmartCollectionSnapshotV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-smart-collection-snapshot';
	readonly selectedId: string | null;
	readonly context: PhotoSmartCollectionSnapshotContextV1;
	readonly definition: Readonly<PhotoSmartCollectionV1> | null;
}

/** Closed scalar selection and intrinsic cancellation detach before lazy database acquisition. */
export function admitPhotoSmartCollectionSnapshotRequestV1(catalogValue: unknown, selectedValue: unknown, value: unknown = {}) {
	const catalogId = id(catalogValue, 'saved snapshot catalog ID');
	const selectedId = selectedValue === null ? null : id(selectedValue, 'saved snapshot selection ID');
	return Object.freeze({ catalogId, selectedId, ...readPhotoSmartCollectionSignalOptionsV1(value) });
}

/** One selected recipe and scalar CAS context share one owning readonly transaction.
 * Creation context loads no definitions; neither path scans photo bodies or all saved recipes.
 * A later write must still compare the revisions and authenticate its bounded storage audit. */
export async function readPhotoSmartCollectionSnapshotV1(database: IDBDatabase, catalogValue: string, selectedValue: string | null,
	options: PhotoSmartCollectionSignalOptionsV1 = {}): Promise<PhotoSmartCollectionSnapshotV1> {
	const admitted = admitPhotoSmartCollectionSnapshotRequestV1(catalogValue, selectedValue, options);
	return withPhotoStackQuerySignalV1(admitted.signal, signal => catalogTransaction(database,
		PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, 'readonly', async stores => {
			const { root, index, state } = await readPhotoSmartCollectionStorageContextV1(stores, admitted.catalogId, signal);
			const definition = admitted.selectedId === null ? null : await readPhotoSmartCollectionDefinitionV1(stores,
				admitted.catalogId, photoSmartCollectionKeyV1(admitted.catalogId, admitted.selectedId), signal);
			if (definition !== null) validatePhotoSmartCollectionReferencesV1(definition, root);
			const context = Object.freeze({ catalogId: admitted.catalogId, catalogRevision: root.revision,
				indexRevision: index.indexRevision, collectionStateRevision: state.revision, collectionCount: state.collectionCount });
			return Object.freeze({ schemaVersion: 1, kind: 'photo-smart-collection-snapshot', selectedId: admitted.selectedId, context, definition });
		}, signal));
}
