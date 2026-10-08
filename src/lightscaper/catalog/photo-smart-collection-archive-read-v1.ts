/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { assertNotAborted, catalogTransaction } from './catalog-transaction.ts';
import { photoSmartCollectionAuditContextDigestV1, readAuditedPhotoSmartCollectionV1,
	readPhotoSmartCollectionAuditKeyV1 } from './photo-smart-collection-audit-kernel.ts';
import { PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, readPhotoSmartCollectionStorageContextV1,
	type PhotoSmartCollectionStorageContextV1 } from './photo-smart-collection-storage-v1.ts';
import type { PhotoSmartCollectionArchiveContextV1 } from './photo-smart-collection-archive-context-v1.ts';
import type { PhotoSmartCollectionV1 } from './photo-smart-collection-v1.ts';
import { PhotoCatalogRevisionConflictError } from './repository-types.ts';
import { field, record } from './value-validation.ts';

type Stores = Readonly<Record<string, IDBObjectStore>>;
/** Private scalar binding includes complete context digest and physical state presence. */
export interface PhotoSmartCollectionArchiveReadBindingV1 {
	readonly context: PhotoSmartCollectionArchiveContextV1;
	readonly digest: string;
}

export async function readPhotoSmartCollectionArchiveBindingV1(stores: Stores, catalogId: string,
	signal?: AbortSignal, captured?: PhotoSmartCollectionStorageContextV1): Promise<PhotoSmartCollectionArchiveReadBindingV1> {
	const context = captured ?? await readPhotoSmartCollectionStorageContextV1(stores, catalogId, signal);
	const key: unknown = await request(stores.photoSmartCollectionStates.getKey(catalogId));
	assertNotAborted(signal);
	if (key !== undefined && key !== catalogId) throw new TypeError('Archive saved collection state key disagrees with its catalog.');
	if (key === undefined && (context.state.revision !== 0 || context.state.collectionCount !== 0)) {
		throw new TypeError('Archive saved collection state disappeared within its context.');
	}
	return Object.freeze({ digest: photoSmartCollectionAuditContextDigestV1(context), context: Object.freeze({
		schemaVersion: 1, kind: 'photo-smart-collection-archive-context', catalogId,
		catalogRevision: context.root.revision, indexRevision: context.index.indexRevision, state: key === undefined ? null : context.state }) });
}

export function assertPhotoSmartCollectionArchiveBindingV1(current: PhotoSmartCollectionArchiveReadBindingV1,
	captured: PhotoSmartCollectionArchiveReadBindingV1): void {
	if (current.digest !== captured.digest || (current.context.state === null) !== (captured.context.state === null)) {
		throw new PhotoCatalogRevisionConflictError('catalog');
	}
}

/** Query2 defaults are useful for transient callers, but cannot repair an incomplete archived recipe. */
export function assertPhotoSmartCollectionArchiveQueryV1(_document: PhotoSmartCollectionV1, raw: unknown): void {
	const input = record(raw, 'archive saved collection record', ['key', 'catalogId', 'referenceKeys', 'document']);
	const definition = record(field(input, 'document'), 'archive saved collection definition',
		['schemaVersion', 'kind', 'catalogId', 'id', 'name', 'revision', 'query']);
	record(field(definition, 'query'), 'complete archive saved Query2', ['schemaVersion', 'kind', 'text', 'filter', 'sort', 'predicate']);
}

/** Each next demand point-authenticates one paired recipe, then joins readonly completion before yield. */
export async function readPhotoSmartCollectionArchiveNextV1(database: IDBDatabase,
	binding: PhotoSmartCollectionArchiveReadBindingV1, afterKey: string | null, signal?: AbortSignal): Promise<PhotoSmartCollectionV1 | null> {
	const catalogId = binding.context.catalogId;
	return catalogTransaction(database, PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, 'readonly', async stores => {
		const context = await readPhotoSmartCollectionStorageContextV1(stores, catalogId, signal);
		assertPhotoSmartCollectionArchiveBindingV1(await readPhotoSmartCollectionArchiveBindingV1(stores, catalogId, signal, context), binding);
		const prefix = JSON.stringify([catalogId]).slice(0, -1) + ',';
		const key: unknown = await firstKey(stores.photoSmartCollections.openKeyCursor(
			IDBKeyRange.bound(afterKey ?? prefix, prefix + '\uffff', afterKey !== null, true)));
		assertNotAborted(signal);
		if (key === undefined) return null;
		const scoped = readPhotoSmartCollectionAuditKeyV1(key, catalogId);
		return (await readAuditedPhotoSmartCollectionV1(stores, context.root, scoped, signal, assertPhotoSmartCollectionArchiveQueryV1)).document;
	}, signal);
}

function firstKey(operation: IDBRequest<IDBCursor | null>): Promise<unknown> {
	return new Promise((resolve, reject) => {
		operation.onerror = () => reject(operation.error ?? new Error('Could not read archive saved collection key.'));
		operation.onsuccess = () => resolve(operation.result?.primaryKey);
	});
}
