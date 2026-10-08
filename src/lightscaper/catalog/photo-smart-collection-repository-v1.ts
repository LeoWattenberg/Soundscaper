/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { assertNotAborted, catalogTransaction } from './catalog-transaction.ts';
import { validateLightscaperDocumentV1 } from './documents.ts';
import { indexState } from './repository-records.ts';
import { auditPhotoSmartCollectionStorageV1, assertPhotoSmartCollectionStorageAuditV1 } from './photo-smart-collection-audit-v1.ts';
import { readPhotoSmartCollectionDefinitionV1, validatePhotoSmartCollectionReferencesV1 } from './photo-smart-collection-read-v1.ts';
import { photoSmartCollectionKeyV1, photoSmartCollectionRecordV1 } from './photo-smart-collection-record-v1.ts';
import { normalizePhotoSmartCollectionV1, PHOTO_SMART_COLLECTION_LIMITS_V1, type PhotoSmartCollectionV1 } from './photo-smart-collection-v1.ts';
import { normalizePhotoSmartCollectionsStateV1, type PhotoSmartCollectionsStateV1 } from './photo-smart-collection-state-v1.ts';
import { PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1 as STORES, readPhotoSmartCollectionStorageContextV1,
	photoSmartCollectionSummaryRecordV1, type PhotoSmartCollectionStorageContextV1 } from './photo-smart-collection-storage-v1.ts';
import { admitPhotoSmartCollectionSaveV1, assertPhotoSmartCollectionContextV1, PhotoSmartCollectionRevisionConflictError,
	readPhotoSmartCollectionWriteOptionsV1, readPhotoSmartCollectionSignalOptionsV1, smartCollectionRevisionV1,
	type PhotoSmartCollectionWriteOptionsV1, type PhotoSmartCollectionSignalOptionsV1, type PhotoSmartCollectionWriteReceiptV1 } from './photo-smart-collection-repository-types-v1.ts';
import { assertPhotoStackQuerySignalV1, withPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { id } from './value-validation.ts';
import type { PhotoCatalogRootV1 } from './types.ts';

const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!;
const nativeReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'reason')!.get!;
const nativeAdd = EventTarget.prototype.addEventListener, nativeRemove = EventTarget.prototype.removeEventListener;
const NativeAbortController = AbortController, nativeAbort = NativeAbortController.prototype.abort;

export async function loadPhotoSmartCollectionV1(database: IDBDatabase, catalogId: string, collectionId: string,
	options: PhotoSmartCollectionSignalOptionsV1 = {}): Promise<Readonly<PhotoSmartCollectionV1> | null> {
	const catalog = id(catalogId, 'saved collection catalog ID'), key = photoSmartCollectionKeyV1(catalog, collectionId);
	const admitted = readPhotoSmartCollectionSignalOptionsV1(options);
	return withPhotoStackQuerySignalV1(admitted.signal, signal => catalogTransaction(database, STORES, 'readonly', async stores => {
		const context = await readPhotoSmartCollectionStorageContextV1(stores, catalog, signal);
		const definition = await readPhotoSmartCollectionDefinitionV1(stores, catalog, key, signal);
		if (definition !== null) validatePhotoSmartCollectionReferencesV1(definition, context.root);
		return definition;
	}, signal));
}
export async function readPhotoSmartCollectionStateV1(database: IDBDatabase, catalogId: string,
	options: PhotoSmartCollectionSignalOptionsV1 = {}): Promise<Readonly<PhotoSmartCollectionsStateV1>> {
	const catalog = id(catalogId, 'saved collection catalog ID'), admitted = readPhotoSmartCollectionSignalOptionsV1(options);
	return withPhotoStackQuerySignalV1(admitted.signal, signal => catalogTransaction(database, STORES, 'readonly', async stores =>
		(await readPhotoSmartCollectionStorageContextV1(stores, catalog, signal)).state, signal));
}
export async function savePhotoSmartCollectionV1(database: IDBDatabase, value: unknown, expectedRevision: number | null,
	options: PhotoSmartCollectionWriteOptionsV1): Promise<Readonly<PhotoSmartCollectionWriteReceiptV1>> {
	const candidate = admitPhotoSmartCollectionSaveV1(value, expectedRevision), admitted = readPhotoSmartCollectionWriteOptionsV1(options);
	return write(database, candidate.catalogId, candidate.id, expectedRevision, candidate, admitted);
}
export async function deletePhotoSmartCollectionV1(database: IDBDatabase, catalogId: string, collectionId: string, expectedRevision: number,
	options: PhotoSmartCollectionWriteOptionsV1): Promise<Readonly<PhotoSmartCollectionWriteReceiptV1>> {
	const catalog = id(catalogId, 'saved collection catalog ID'), collection = id(collectionId, 'saved collection ID');
	const expected = smartCollectionRevisionV1(expectedRevision), admitted = readPhotoSmartCollectionWriteOptionsV1(options);
	return write(database, catalog, collection, expected, null, admitted);
}

/** Unlike a read, native completion is the ACK boundary; a late abort cannot erase it. */
export async function withPhotoSmartCollectionWriteSignalV1<Result>(signal: AbortSignal | undefined,
	run: (privateSignal: AbortSignal | undefined) => Promise<Result>): Promise<Result> {
	if (signal === undefined) return run(undefined);
	assertPhotoStackQuerySignalV1(signal);
	const stop = new NativeAbortController();
	const forward = (): void => { const reason: unknown = Reflect.apply(nativeReason, signal, []); Reflect.apply(nativeAbort, stop, [reason]); };
	try {
		Reflect.apply(nativeAdd, signal, ['abort', forward, { once: true }]);
		if (Reflect.apply(nativeAborted, signal, []) === true) forward();
		assertNotAborted(stop.signal);
		return await run(stop.signal);
	} finally { Reflect.apply(nativeRemove, signal, ['abort', forward]); }
}

async function write(database: IDBDatabase, catalogId: string, collectionId: string, expected: number | null,
	candidate: PhotoSmartCollectionV1 | null, options: PhotoSmartCollectionWriteOptionsV1): Promise<Readonly<PhotoSmartCollectionWriteReceiptV1>> {
	return withPhotoSmartCollectionWriteSignalV1(options.signal, async signal => {
		const captured = await catalogTransaction(database, STORES, 'readonly', async stores => {
			const context = await readPhotoSmartCollectionStorageContextV1(stores, catalogId, signal);
			assertPhotoSmartCollectionContextV1(context, options);
			if (candidate) validatePhotoSmartCollectionReferencesV1(candidate, context.root);
			return context;
		}, signal);
		// The detached authored candidate remains live through every audit page; its projection is created afterward.
		const retainedBytes = candidate === null ? 0 : new TextEncoder().encode(JSON.stringify(candidate)).byteLength;
		const proof = await auditPhotoSmartCollectionStorageV1(database, captured.root, {
			expectedCatalogRevision: options.expectedCatalogRevision, retainedBytes, signal });
		return catalogTransaction(database, STORES, 'readwrite', async stores => {
			const context = await readPhotoSmartCollectionStorageContextV1(stores, catalogId, signal);
			assertPhotoSmartCollectionContextV1(context, options);
			assertPhotoSmartCollectionStorageAuditV1(proof, database, context, context.root);
			const key = photoSmartCollectionKeyV1(catalogId, collectionId);
			const previous = await readPhotoSmartCollectionDefinitionV1(stores, catalogId, key, signal);
			if (expected === null ? previous !== null : previous === null || previous.revision !== expected) throw new PhotoSmartCollectionRevisionConflictError();
			if (candidate) validatePhotoSmartCollectionReferencesV1(candidate, context.root);
			const next = candidate === null ? null : normalizePhotoSmartCollectionV1({ ...candidate, revision: previous === null ? 0 : increment(previous.revision) });
			const delta = candidate === null ? -1 : previous === null ? 1 : 0;
			const state = normalizePhotoSmartCollectionsStateV1({ ...context.state, revision: increment(context.state.revision), collectionCount: context.state.collectionCount + delta });
			if (context.root.collections.length + state.collectionCount > PHOTO_SMART_COLLECTION_LIMITS_V1.maximumCollections) throw new RangeError('Combined collection count exceeds its 10000 collection budget.');
			const root = nextRoot(context), index = indexState(root, increment(context.index.indexRevision));
			const row = next === null ? null : photoSmartCollectionRecordV1(next), summary = next === null ? null : photoSmartCollectionSummaryRecordV1(next);
			// All increments, identities and serialized budgets have passed before the first mutation.
			assertNotAborted(signal);
			if (row === null) { await request(stores.photoSmartCollections.delete(key)); await request(stores.photoSmartCollectionSummaries.delete(key)); }
			else { await request(stores.photoSmartCollections.put(row)); await request(stores.photoSmartCollectionSummaries.put(summary)); }
			await request(stores.catalogs.put(root)); await request(stores.catalogStates.put(index)); await request(stores.photoSmartCollectionStates.put(state));
			return Object.freeze({ schemaVersion: 1, kind: 'photo-smart-collection-write', catalogId, catalogRevision: root.revision,
				indexRevision: index.indexRevision, state, definition: next });
		}, signal);
	});
}
function increment(value: number): number { return smartCollectionRevisionV1(value + 1); }
function nextRoot(context: PhotoSmartCollectionStorageContextV1): PhotoCatalogRootV1 {
	const root = validateLightscaperDocumentV1({ ...context.root, revision: increment(context.root.revision) });
	if (root.kind !== 'photo-catalog') throw new TypeError('A catalog root is required.'); return root;
}
