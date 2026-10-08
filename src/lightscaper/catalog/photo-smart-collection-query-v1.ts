/* SPDX-License-Identifier: AGPL-3.0-only */

import { catalogTransaction, assertNotAborted } from './catalog-transaction.ts';
import { photoSmartCollectionKeyV1 } from './photo-smart-collection-record-v1.ts';
import { readPhotoSmartCollectionDefinitionV1, validatePhotoSmartCollectionReferencesV1 } from './photo-smart-collection-read-v1.ts';
import { PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, readPhotoSmartCollectionStorageContextV1 } from './photo-smart-collection-storage-v1.ts';
import { readPhotoQueryPageInTransactionV2 } from './photo-query-page-kernel-v2.ts';
import { readPhotoQueryRowV2, photoQueryRowKeyV2, photoQuerySummaryV2 } from './photo-query-index-v2.ts';
import { readPhotoQueryBuildStateV2 } from './photo-query-index-storage-v2.ts';
import { photoQueryMatcherV2 } from './photo-query-matcher-v2.ts';
import { photoQueryDigestV2, type PhotoQueryContinuationV2 } from './photo-query-types-v2.ts';
import { readPhotoStackQueryInTransaction, type PhotoStackQueryKernelProgress } from './photo-stack-query-kernel.ts';
import { withPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { PhotoSmartCollectionRevisionConflictError } from './photo-smart-collection-repository-types-v1.ts';
import { authenticatePhotoSavedQueryProgressV1, issuePhotoSavedQueryProgressV1, photoSavedDefinitionDigestV1 } from './photo-smart-collection-query-progress-v1.ts';
import { admitPhotoSavedQueryPageRequestV1, type PhotoSavedQueryPageRequestV1, type PhotoSavedQueryPageV1,
	type PhotoSavedQueryModeV1 } from './photo-smart-collection-query-types-v1.ts';

export function readPhotoSmartCollectionQueryPageV1(database: IDBDatabase, catalogId: string, collectionId: string,
	options: PhotoSavedQueryPageRequestV1 = {}): Promise<PhotoSavedQueryPageV1> {
	return read(database, catalogId, collectionId, 'ordinary', options);
}
export function readPhotoSmartCollectionStackQueryPageV1(database: IDBDatabase, catalogId: string, collectionId: string,
	options: PhotoSavedQueryPageRequestV1 = {}): Promise<PhotoSavedQueryPageV1> {
	return read(database, catalogId, collectionId, 'collapsed', options);
}

/** Admission owns one <=603424B private row and one <=528384B normalized definition.
 * Traversal owns the <=2MiB root and <=64 scalar summaries. Ordinary scanning admits one
 * <=1MiB Row2; collapsed traversal can retain its candidate plus one <=1MiB point probe,
 * one <=256KiB portable stack and <=512KiB private stack admission scratch.
 * Compilation additionally normalizes a <=512KiB predicate and folds <=256 admitted needles
 * (each source <=256 UTF16 units); those strings remain part of the compiled owner.
 * Definition/query hashing separately materializes canonical JSON and matching UTF8 bytes,
 * bounded by528384/524288B respectively. These are bounded phases, not an8MiB heap claim. */
async function read(database: IDBDatabase, catalogValue: string, collectionValue: string, mode: PhotoSavedQueryModeV1,
	options: PhotoSavedQueryPageRequestV1): Promise<PhotoSavedQueryPageV1> {
	const admitted = admitPhotoSavedQueryPageRequestV1(catalogValue, collectionValue, mode, options);
	const { catalogId, collectionId, continuation } = admitted;
	authenticatePhotoSavedQueryProgressV1(database, continuation);
	const storesOwned = [...PHOTO_SMART_COLLECTION_CONTEXT_STORES_V1, 'photoQueryRowsV2', 'photoQueryBuildStatesV2',
		...(mode === 'collapsed' ? ['photoStacks', 'photoStackStates', 'photoStackMemberships'] : [])];
	return withPhotoStackQuerySignalV1(admitted.signal, signal => catalogTransaction(database, storesOwned, 'readonly', async stores => {
		const context = await readPhotoSmartCollectionStorageContextV1(stores, catalogId, signal);
		const definition = await readPhotoSmartCollectionDefinitionV1(stores, catalogId, photoSmartCollectionKeyV1(catalogId, collectionId), signal);
		if (definition === null) throw new ReferenceError('Selected saved collection is missing.');
		validatePhotoSmartCollectionReferencesV1(definition, context.root);
		const query = definition.query, definitionSha256 = photoSavedDefinitionDigestV1(definition), querySha256 = photoQueryDigestV2(query);
		if (continuation) {
			if (continuation.definitionRevision !== definition.revision || continuation.collectionStateRevision !== context.state.revision
				|| continuation.catalogRevision !== context.root.revision || continuation.indexRevision !== context.index.indexRevision) {
				throw new PhotoSmartCollectionRevisionConflictError();
			}
			if (continuation.definitionSha256 !== definitionSha256 || continuation.querySha256 !== querySha256
				|| JSON.stringify(continuation.sort) !== JSON.stringify(query.sort)) throw new TypeError('Saved query definition or query digest changed.');
		}
		const matches = photoQueryMatcherV2(context.root, query);
		assertNotAborted(signal);
		const identity = { catalogId, collectionId, definitionRevision: definition.revision, collectionStateRevision: context.state.revision,
			definitionSha256, querySha256, catalogRevision: context.root.revision, indexRevision: context.index.indexRevision };
		let items: PhotoSavedQueryPageV1['items'], scanned: number, next: PhotoSavedQueryPageV1['continuation'], stackStateRevision: number | null;
		if (mode === 'ordinary') {
			const incoming: PhotoQueryContinuationV2 | null = continuation === null ? null : { schemaVersion: 2, kind: 'photo-query',
				catalogId, catalogRevision: continuation.catalogRevision, indexRevision: continuation.indexRevision,
				querySha256, captureBucket: continuation.captureBucket, afterKey: continuation.afterKey };
			const result = await readPhotoQueryPageInTransactionV2(stores, catalogId, context.root, context.index, query, incoming, () => matches, signal);
			items = result.items; scanned = result.scanned; stackStateRevision = null;
			next = result.continuation === null ? null : issuePhotoSavedQueryProgressV1(database, { schemaVersion: 1, kind: 'saved-photo-query', mode,
				...identity, sort: query.sort, captureBucket: result.continuation.captureBucket, afterKey: result.continuation.afterKey,
				stackStateRevision, pending: null, stackAudit: null });
		} else {
			const incoming: PhotoStackQueryKernelProgress | null = continuation === null ? null : { catalogId,
				catalogRevision: continuation.catalogRevision, indexRevision: continuation.indexRevision, stateRevision: continuation.stackStateRevision!,
				captureBucket: continuation.captureBucket, afterKey: continuation.afterKey, pending: continuation.pending, stackAudit: continuation.stackAudit };
			const result = await readPhotoStackQueryInTransaction(stores, context.root, context.index, catalogId, query, incoming, {
				rowStore: 'photoQueryRowsV2', buildStore: 'photoQueryBuildStatesV2', readRow: readPhotoQueryRowV2,
				readBuild: readPhotoQueryBuildStateV2, rowKey: photoQueryRowKeyV2, summarize: photoQuerySummaryV2,
				matcher: () => matches, issueProgress: progress => progress,
			}, signal);
			items = result.items; scanned = result.scanned; stackStateRevision = result.stateRevision;
			next = result.continuation === null ? null : issuePhotoSavedQueryProgressV1(database, { schemaVersion: 1, kind: 'saved-photo-query', mode,
				...identity, sort: query.sort, captureBucket: result.continuation.captureBucket, afterKey: result.continuation.afterKey,
				stackStateRevision, pending: result.continuation.pending, stackAudit: result.continuation.stackAudit });
		}
		return Object.freeze({ schemaVersion: 1, kind: 'saved-photo-query-page', mode, ...identity,
			catalogName: context.root.name, totalCount: context.root.photoCount, collectionName: definition.name,
			stackStateRevision, items, scanned, continuation: next });
	}, signal));
}
