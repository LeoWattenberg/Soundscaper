/* SPDX-License-Identifier: AGPL-3.0-only */

import { readValidatedPhotoCatalogRootV1, validateLightscaperDocumentV1 } from './documents.ts';
import { validatePhotoCatalogReferencesV1 } from './photo-document.ts';
import { indexState, photoMemberships, photoStorageKey, photoSummary } from './repository-records.ts';
import type { PhotoCatalogIndexStateV1, PhotoMembershipV1, PhotoSummaryV1 } from './repository-types.ts';
import type { PhotoCatalogRootV1, PhotoDocumentV1 } from './types.ts';
import { projectPhotoQueryRowV1, readPhotoQueryBuildStateV1, type PhotoQueryBuildStateV1, type PhotoQueryRowV1 } from './photo-query-index-v1.ts';
import { projectPhotoQueryRowV2, type PhotoQueryRowV2 } from './photo-query-index-v2.ts';
import { readPhotoQueryBuildStateV2, type PhotoQueryBuildStateV2 } from './photo-query-index-storage-v2.ts';
import { photoStackRecordV1, type PhotoStackRecordV1 } from './photo-stack-record-v1.ts';
import { normalizePhotoStackStateV1, type PhotoStackStateV1 } from './photo-stack-v1.ts';
import { photoSmartCollectionRecordV1, type PhotoSmartCollectionRecordV1 } from './photo-smart-collection-record-v1.ts';
import { photoSmartCollectionSummaryRecordV1, type PhotoSmartCollectionSummaryRecordV1 } from './photo-smart-collection-storage-v1.ts';
import { validatePhotoSmartCollectionReferencesV1 } from './photo-smart-collection-read-v1.ts';
import { normalizePhotoSmartCollectionsStateV1, type PhotoSmartCollectionsStateV1 } from './photo-smart-collection-state-v1.ts';
import { PHOTO_SMART_COLLECTION_LIMITS_V1 } from './photo-smart-collection-v1.ts';

export interface PhotoCatalogRestoreRootRecordsV1 {
	readonly root: PhotoCatalogRootV1;
	readonly index: PhotoCatalogIndexStateV1;
	readonly stackState: PhotoStackStateV1;
	readonly queryBuildV1: PhotoQueryBuildStateV1;
	readonly queryBuildV2: PhotoQueryBuildStateV2;
	readonly savedState: Readonly<PhotoSmartCollectionsStateV1> | null;
}
export interface PhotoCatalogRestorePhotoRecordsV1 {
	readonly photo: Readonly<{ key: string; document: PhotoDocumentV1 }>;
	readonly summary: PhotoSummaryV1;
	readonly memberships: readonly PhotoMembershipV1[];
	readonly queryV1: PhotoQueryRowV1 | null;
	readonly queryV2: PhotoQueryRowV2;
}
export interface PhotoCatalogRestoreStackMembershipV1 {
	readonly key: string; readonly catalogId: string; readonly photoId: string; readonly stackId: string; readonly scope: string;
}
export interface PhotoCatalogRestoreStackRecordsV1 {
	readonly stack: PhotoStackRecordV1;
	readonly memberships: readonly PhotoCatalogRestoreStackMembershipV1[];
}
export interface PhotoCatalogRestoreSavedCollectionRecordsV1 {
	readonly definition: PhotoSmartCollectionRecordV1;
	readonly summary: PhotoSmartCollectionSummaryRecordV1;
}

/** Fresh private database only: callers add immutable records, then audit before declaring indexes ready. */
export function photoCatalogRestoreRootRecordsV1(rootValue: unknown, stateValue: unknown): PhotoCatalogRestoreRootRecordsV1 {
	const root = readValidatedPhotoCatalogRootV1(rootValue);
	const savedState = stateValue === null ? null : normalizePhotoSmartCollectionsStateV1(stateValue);
	if (savedState !== null && savedState.catalogId !== root.id) throw new TypeError('Restored saved state belongs to another catalog.');
	if (root.collections.length + (savedState?.collectionCount ?? 0) > PHOTO_SMART_COLLECTION_LIMITS_V1.maximumCollections) {
		throw new RangeError('Combined restored collection count exceeds its 10000 collection budget.');
	}
	return Object.freeze({ root, index: indexState(root, 0),
		stackState: normalizePhotoStackStateV1({ schemaVersion: 1, kind: 'photo-stack-state', catalogId: root.id, revision: 0, stackCount: 0 }),
		queryBuildV1: readPhotoQueryBuildStateV1({ id: root.id, schemaVersion: 1, ready: false, afterKey: null, indexedCount: 0 }, root.id),
		queryBuildV2: readPhotoQueryBuildStateV2({ id: root.id, schemaVersion: 2, ready: false, afterKey: null, indexedCount: 0 }, root.id), savedState });
}

/**
 * One serial packet, without original bodies. Existing document/row/membership bounds apply independently.
 * The decoder may still retain its source photo while this owning validation detaches it; account for both,
 * the borrowed root and projections. This is not an 8 MiB whole-heap or whole-scan memory guarantee.
 */
export function photoCatalogRestorePhotoRecordsV1(rootValue: unknown, value: unknown): PhotoCatalogRestorePhotoRecordsV1 {
	const root = readValidatedPhotoCatalogRootV1(rootValue), document = validateLightscaperDocumentV1(value);
	if (document.kind !== 'photo') throw new TypeError('Restore requires a photo document.');
	validatePhotoCatalogReferencesV1(document, root);
	let queryV1: PhotoQueryRowV1 | null;
	try { queryV1 = projectPhotoQueryRowV1(document); }
	catch (error) {
		// Only this owning synchronous legacy projection refusal can omit a derived row.
		if (!(error instanceof RangeError) || error.message !== 'Photo query row exceeds its byte budget.') throw error;
		queryV1 = null;
	}
	return Object.freeze({ photo: Object.freeze({ key: photoStorageKey(root.id, document.id), document }),
		summary: photoSummary(document), memberships: photoMemberships(document), queryV1, queryV2: projectPhotoQueryRowV2(document) });
}

/** Native add plus the unique forward memberKey index must refuse cross-stack membership collisions. */
export function photoCatalogRestoreStackRecordsV1(rootValue: unknown, value: unknown): PhotoCatalogRestoreStackRecordsV1 {
	const root = readValidatedPhotoCatalogRootV1(rootValue), stack = photoStackRecordV1(value), document = stack.document;
	if (document.catalogId !== root.id) throw new TypeError('Restored stack belongs to another catalog.');
	if (document.photoIds.length > root.photoCount) throw new RangeError('Restored stack exceeds the declared catalog photo count.');
	return Object.freeze({ stack, memberships: Object.freeze(document.photoIds.map(photoId => Object.freeze({
		key: photoStorageKey(root.id, photoId), catalogId: root.id, photoId, stackId: document.id, scope: stack.key,
	}))) });
}

/** Preserve the complete recipe/revision; persisted identity/count uniqueness belongs to the private stage and audit. */
export function photoCatalogRestoreSavedCollectionRecordsV1(rootValue: unknown, value: unknown): PhotoCatalogRestoreSavedCollectionRecordsV1 {
	const root = readValidatedPhotoCatalogRootV1(rootValue), definition = photoSmartCollectionRecordV1(value);
	if (definition.document.catalogId !== root.id) throw new TypeError('Restored saved collection belongs to another catalog.');
	validatePhotoSmartCollectionReferencesV1(definition.document, root);
	return Object.freeze({ definition, summary: photoSmartCollectionSummaryRecordV1(definition.document) });
}
