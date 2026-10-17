/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { photoStorageKey } from './repository-records.ts';
import { readPhotoStackRecordV1 } from './photo-stack-record-v1.ts';
import { readAuditedPhotoSmartCollectionV1, readPhotoSmartCollectionAuditKeyV1 } from './photo-smart-collection-audit-kernel.ts';
import { assertPhotoSmartCollectionArchiveQueryV1 } from './photo-smart-collection-archive-read-v1.ts';
import { photoCatalogRestorePhotoRecordsV1, photoCatalogRestoreStackRecordsV1,
	photoCatalogRestoreSavedCollectionRecordsV1 } from './photo-catalog-restore-records-v1.ts';
import { assertPhotoCatalogRestoreValueV1, assertPhotoCatalogRestoreRecordV1, type PhotoCatalogRestoreStoresV1,
	type PhotoCatalogRestoreStoreV1 } from './photo-catalog-restore-audit-pages-v1.ts';
import type { PhotoCatalogRestoreFinalizeContextV1 } from './photo-catalog-restore-finalize-v1.ts';
import { field, id, record } from './value-validation.ts';

export interface PhotoCatalogRestoreAuditTotalsV1 { memberships: number; stackMemberships: number; legacyRows: number }

/** One source and its independently bounded projections at a time; this is not a whole-heap byte claim. */
export async function auditPhotoCatalogRestoreRecordV1(stores: PhotoCatalogRestoreStoresV1, store: PhotoCatalogRestoreStoreV1,
	key: string, context: PhotoCatalogRestoreFinalizeContextV1, totals: PhotoCatalogRestoreAuditTotalsV1): Promise<void> {
	if (store === 'photos') {
		const rows = await photoRows(stores, key, context);
		context.assertDelivered('photo', rows.photo.document);
		await assertPhotoCatalogRestoreRecordV1(stores, 'summaries', key, rows.summary);
		await assertPhotoCatalogRestoreRecordV1(stores, 'photoQueryRowsV2', key, rows.queryV2);
		if (rows.queryV1 === null) {
			if (await request(stores.photoQueryRows.getKey(key)) !== undefined) throw new TypeError('Ineligible legacy query projection is present.');
		} else { await assertPhotoCatalogRestoreRecordV1(stores, 'photoQueryRows', key, rows.queryV1); totals.legacyRows++; }
		for (const row of rows.memberships) await assertPhotoCatalogRestoreRecordV1(stores, 'memberships', row.key, row);
		totals.memberships += rows.memberships.length; return;
	}
	if (store === 'photoStacks') {
		const raw: unknown = await request(stores.photoStacks.get(key));
		const document = readPhotoStackRecordV1(raw, context.root.id, key);
		const rows = photoCatalogRestoreStackRecordsV1(context.root, document);
		assertPhotoCatalogRestoreValueV1(raw, rows.stack); context.assertDelivered('stack', document);
		for (const row of rows.memberships) {
			await assertPhotoCatalogRestoreRecordV1(stores, 'photoStackMemberships', row.key, row);
			if (await request(stores.photos.getKey(row.key)) !== row.key) throw new TypeError('Restored stack member photo is missing.');
			if (await request(stores.photoStacks.index('memberKey').getKey(row.key)) !== key) throw new TypeError('Restored unique stack membership index disagrees.');
		}
		totals.stackMemberships += rows.memberships.length; return;
	}
	if (store === 'photoSmartCollections') {
		const { document } = await readAuditedPhotoSmartCollectionV1(stores, context.root, key, undefined, assertPhotoSmartCollectionArchiveQueryV1);
		const rows = photoCatalogRestoreSavedCollectionRecordsV1(context.root, document);
		await assertPhotoCatalogRestoreRecordV1(stores, store, key, rows.definition);
		await assertPhotoCatalogRestoreRecordV1(stores, 'photoSmartCollectionSummaries', key, rows.summary);
		context.assertDelivered('saved', document);
		return;
	}
}

export function auditPhotoCatalogRestoreKeyV1(store: PhotoCatalogRestoreStoreV1, key: string, catalogId: string): void {
	// Every expected derived key/value was checked forward. Native unique primary keys plus exact
	// global counts prove the bijection; reverse inventory never reloads full metadata or recipes.
	if (store === 'photoSmartCollectionSummaries') { readPhotoSmartCollectionAuditKeyV1(key, catalogId); return; }
	if (store === 'memberships') {
		const parts = key.split('|');
		if (parts.length !== 4 || parts[0] !== catalogId) throw new TypeError('Restored membership key belongs to another catalog.');
		id(parts[3], 'restored membership photo ID'); return;
	}
	if (store === 'summaries' || store === 'photoQueryRows' || store === 'photoQueryRowsV2' || store === 'photoStackMemberships') {
		const parts = key.split('|');
		if (parts.length !== 2 || parts[0] !== catalogId || photoStorageKey(catalogId, id(parts[1], 'restored photo ID')) !== key) {
			throw new TypeError('Restored derived key belongs to another catalog.');
		}
		return;
	}
	if (key !== catalogId) throw new TypeError('Restored candidate contains foreign control rows.');
}

async function photoRows(stores: PhotoCatalogRestoreStoresV1, key: string, context: PhotoCatalogRestoreFinalizeContextV1) {
	const raw: unknown = await request(stores.photos.get(key));
	const input = record(raw, 'restored stored photo', ['key', 'document']);
	const rows = photoCatalogRestorePhotoRecordsV1(context.root, field(input, 'document')), document = rows.photo.document;
	if (document.catalogId !== context.root.id || key !== photoStorageKey(context.root.id, document.id)) throw new TypeError('Restored photo belongs to a foreign catalog.');
	assertPhotoCatalogRestoreValueV1(raw, rows.photo); return rows;
}
