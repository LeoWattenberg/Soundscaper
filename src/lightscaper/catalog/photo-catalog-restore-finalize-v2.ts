/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { catalogTransaction } from './catalog-transaction.ts';
import { PHOTO_CATALOG_STORES } from './repository-types.ts';
import type { PhotoCatalogRootV1 } from './types.ts';
import { assertPhotoCatalogRestoreProfileV1, type PhotoCatalogRestoreProfileV1, type PhotoCatalogRestorePhotoForProfileV1 } from './internal/photo-catalog-restore-records-kernel-v1.ts';
import type { PhotoStackV1 } from './photo-stack-v1.ts';
import type { PhotoSmartCollectionV1 } from './photo-smart-collection-v1.ts';
import type { PhotoSmartCollectionsStateV1 } from './photo-smart-collection-state-v1.ts';
import { photoCatalogRestoreRootRecordsV1 } from './photo-catalog-restore-records-v2.ts';
import { auditPhotoCatalogRestoreStoreV1, assertPhotoCatalogRestoreRecordV1, type PhotoCatalogRestoreStoresV1,
	type PhotoCatalogRestoreStoreV1 } from './photo-catalog-restore-audit-pages-v1.ts';
import { auditPhotoCatalogRestoreRecordForProfileV1, auditPhotoCatalogRestoreKeyV2 } from './photo-catalog-restore-audit-v2.ts';
import { integer } from './value-validation.ts';
import { normalizePhotoLibraryRestoreAllocationV1, PHOTO_CATALOG_RESTORE_OWNER_STORE_V1, type PhotoLibraryRestoreAllocationV1 } from '../storage/photo-library-restore-ownership-v1.ts';
import { assertPhotoCatalogRestoreNamespaceProfileV1, assertPhotoCatalogRestoreOwnerV1, photoCatalogRestoreNamespaceStoresV1 } from './photo-catalog-restore-owner-v1.ts';

export interface PhotoCatalogRestoreFinalizeContextForProfileV1<Profile extends PhotoCatalogRestoreProfileV1> {
	readonly root: PhotoCatalogRootV1;
	readonly savedState: Readonly<PhotoSmartCollectionsStateV1> | null;
	readonly photoCount: number;
	readonly stackCount: number;
	readonly savedCollectionCount: number;
	readonly legacyQueryIndexedCount: number;
	readonly assertDelivered: (kind: 'photo' | 'stack' | 'saved', document: PhotoCatalogRestorePhotoForProfileV1<Profile> | PhotoStackV1 | PhotoSmartCollectionV1) => void;
	readonly restoreAllocation?: PhotoLibraryRestoreAllocationV1;
}

export type PhotoCatalogRestoreFinalizeContextV2 = PhotoCatalogRestoreFinalizeContextForProfileV1<'legacy2'>;
export function finalizePhotoCatalogRestoreCandidateV2(database: IDBDatabase, context: PhotoCatalogRestoreFinalizeContextV2, signal?: AbortSignal): Promise<void> {
	return finalizePhotoCatalogRestoreCandidateForProfileV1('legacy2', database, context, signal);
}

/**
 * Internal fresh, sealed serial stage only. Page audits do not promise exclusion of arbitrary raw
 * concurrent same-key rewrites after an audited page. Stage retains all connection/delete ownership.
 * Readiness changes only in the final all-store transaction, whose completion is the candidate ACK.
 */
export async function finalizePhotoCatalogRestoreCandidateForProfileV1<Profile extends PhotoCatalogRestoreProfileV1>(profile: Profile, database: IDBDatabase,
	context: PhotoCatalogRestoreFinalizeContextForProfileV1<Profile>, signal?: AbortSignal): Promise<void> {
	assertPhotoCatalogRestoreProfileV1(profile);
	const initial = photoCatalogRestoreRootRecordsV1(context.root, context.savedState);
	const allocation = context.restoreAllocation === undefined ? undefined : normalizePhotoLibraryRestoreAllocationV1(context.restoreAllocation);
	if (allocation !== undefined && allocation.catalogId !== initial.root.id) throw new TypeError('Catalog restore owner belongs to another catalog.');
	assertPhotoCatalogRestoreNamespaceProfileV1(database, allocation);
	const storesInTransaction = photoCatalogRestoreNamespaceStoresV1(allocation);
	const assertDelivered = context.assertDelivered;
	if (typeof assertDelivered !== 'function') throw new TypeError('Restore delivery authentication is required.');
	const admitted = Object.freeze({ ...context, root: initial.root, savedState: initial.savedState,
		assertDelivered: (...args: Parameters<typeof assertDelivered>): void => Reflect.apply(assertDelivered, context, args) });
	const photoCount = integer(context.photoCount, 0, 10_000_000, 'restored photo count');
	const stackCount = integer(context.stackCount, 0, photoCount, 'restored stack count');
	const savedCount = integer(context.savedCollectionCount, 0, 10_000, 'restored saved count');
	const legacyCount = integer(context.legacyQueryIndexedCount, 0, photoCount, 'restored legacy row count');
	if (photoCount !== initial.root.photoCount || savedCount !== (initial.savedState?.collectionCount ?? 0)) throw new TypeError('Restore delivery counts differ from archived state.');
	const controls = async (stores: PhotoCatalogRestoreStoresV1) => {
		if (allocation !== undefined) await assertPhotoCatalogRestoreOwnerV1(stores[PHOTO_CATALOG_RESTORE_OWNER_STORE_V1]!, allocation);
		await assertPhotoCatalogRestoreRecordV1(stores, 'catalogs', initial.root.id, initial.root);
		await assertPhotoCatalogRestoreRecordV1(stores, 'catalogStates', initial.root.id, initial.index);
		await assertPhotoCatalogRestoreRecordV1(stores, 'photoStackStates', initial.root.id, initial.stackState);
		await assertPhotoCatalogRestoreRecordV1(stores, 'photoQueryBuildStates', initial.root.id, initial.queryBuildV1);
		await assertPhotoCatalogRestoreRecordV1(stores, 'photoQueryBuildStatesV2', initial.root.id, initial.queryBuildV2);
		if (initial.savedState === null) {
			if (await request(stores.photoSmartCollectionStates.getKey(initial.root.id)) !== undefined) throw new TypeError('Absent archived saved state became physical.');
		} else await assertPhotoCatalogRestoreRecordV1(stores, 'photoSmartCollectionStates', initial.root.id, initial.savedState);
	};
	await catalogTransaction(database, storesInTransaction, 'readonly', controls, signal);
	const totals = { memberships: 0, stackMemberships: 0, legacyRows: 0 };
	const counts = {} as Record<PhotoCatalogRestoreStoreV1, number>;
	const expected: Record<PhotoCatalogRestoreStoreV1, number> = { catalogs: 1, catalogStates: 1, photos: photoCount, summaries: photoCount,
		memberships: 0, photoQueryRows: legacyCount, photoQueryBuildStates: 1, photoStacks: stackCount,
		photoStackMemberships: 0, photoStackStates: 1, photoQueryRowsV2: photoCount, photoQueryBuildStatesV2: 1,
		photoSmartCollections: savedCount, photoSmartCollectionSummaries: savedCount, photoSmartCollectionStates: initial.savedState === null ? 0 : 1 };
	for (const store of PHOTO_CATALOG_STORES) {
		// Source phases precede their reverse stores; totals are authenticated before setting each cap.
		if (store === 'memberships') expected.memberships = totals.memberships;
		if (store === 'photoStackMemberships') expected.photoStackMemberships = totals.stackMemberships;
		const source = store === 'photos' || store === 'photoStacks' || store === 'photoSmartCollections';
		counts[store] = await auditPhotoCatalogRestoreStoreV1(database, store, key => source
			? catalogTransaction(database, PHOTO_CATALOG_STORES, 'readonly', stores => auditPhotoCatalogRestoreRecordForProfileV1(profile, stores, store, key, admitted, totals), signal)
			: auditPhotoCatalogRestoreKeyV2(store, key, initial.root.id), signal, expected[store]);
	}
	for (const store of PHOTO_CATALOG_STORES) if (counts[store] !== expected[store]) throw new TypeError(`Restored ${store} inventory count differs from canonical delivery.`);
	if (totals.legacyRows !== legacyCount) throw new TypeError('Restored legacy eligibility differs from acknowledged delivery.');
	await catalogTransaction(database, storesInTransaction, 'readwrite', async stores => {
		assertPhotoCatalogRestoreNamespaceProfileV1(database, allocation);
		await controls(stores);
		for (const store of PHOTO_CATALOG_STORES) if (await request(stores[store].count()) !== expected[store]) throw new TypeError('Restored candidate inventory changed before readiness.');
		await request(stores.photoQueryBuildStates.put({ ...initial.queryBuildV1, ready: legacyCount === photoCount, indexedCount: legacyCount }));
		await request(stores.photoQueryBuildStatesV2.put({ ...initial.queryBuildV2, ready: true, indexedCount: photoCount }));
		await request(stores.photoStackStates.put({ ...initial.stackState, stackCount }));
	}, signal);
}
