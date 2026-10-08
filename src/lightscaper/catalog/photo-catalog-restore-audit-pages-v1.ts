/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { catalogTransaction, assertNotAborted } from './catalog-transaction.ts';
import type { PHOTO_CATALOG_STORES } from './repository-types.ts';

export type PhotoCatalogRestoreStoresV1 = Readonly<Record<string, IDBObjectStore>>;
export type PhotoCatalogRestoreStoreV1 = typeof PHOTO_CATALOG_STORES[number];
export const PHOTO_CATALOG_RESTORE_AUDIT_PAGE_SIZE_V1 = 64;

/** Exact closed projection comparison without retaining another serialized metadata document. */
export function assertPhotoCatalogRestoreValueV1(actual: unknown, expected: unknown): void {
	if (Object.is(actual, expected)) return;
	if (actual === null || expected === null || typeof actual !== 'object' || typeof expected !== 'object'
		|| Array.isArray(actual) !== Array.isArray(expected)) throw new TypeError('Restored persisted projection differs from its source.');
	const left = Object.getOwnPropertyDescriptors(actual), right = Object.getOwnPropertyDescriptors(expected);
	const keys = Reflect.ownKeys(right);
	if (Reflect.ownKeys(left).length !== keys.length) throw new TypeError('Restored persisted projection has unexpected fields.');
	for (const key of keys) {
		const a = Reflect.get(left, key) as PropertyDescriptor | undefined, b = Reflect.get(right, key) as PropertyDescriptor;
		if (!a || !Object.hasOwn(a, 'value') || !Object.hasOwn(b, 'value')) throw new TypeError('Restored projection requires own data fields.');
		assertPhotoCatalogRestoreValueV1(a.value as unknown, b.value as unknown);
	}
}

/** Global primary-key inventory, including foreign rows; no scoped index can hide an orphan. */
export async function auditPhotoCatalogRestoreStoreV1(database: IDBDatabase, store: PhotoCatalogRestoreStoreV1,
	visit: (key: string) => Promise<void> | void, signal?: AbortSignal, maximumCount = Number.MAX_SAFE_INTEGER): Promise<number> {
	if (!Number.isSafeInteger(maximumCount) || maximumCount < 0) throw new RangeError('Restore inventory count requires a bounded nonnegative integer.');
	let after: string | null = null, count = 0;
	for (;;) {
		const keys = await catalogTransaction(database, [store], 'readonly', stores => readKeys(stores[store], after,
			maximumKeyLength(store), maximumCount - count), signal);
		if (keys.length === 0) return count;
		for (const key of keys) {
			await visit(key);
			count++; assertNotAborted(signal);
		}
		after = keys[keys.length - 1]!;
	}
}

function maximumKeyLength(store: PhotoCatalogRestoreStoreV1): number {
	if (store === 'memberships') return 397; // 128 catalog + three separators +10 kind +128 value +128 photo.
	if (store === 'photoSmartCollections' || store === 'photoSmartCollectionSummaries') return 263;
	if (store === 'catalogs' || store === 'catalogStates' || store === 'photoStackStates' || store === 'photoSmartCollectionStates'
		|| store === 'photoQueryBuildStates' || store === 'photoQueryBuildStatesV2') return 128;
	return 257; // Two <=128 ASCII identities with one separator.
}

function readKeys(store: IDBObjectStore, after: string | null, maximum: number, remaining: number): Promise<readonly string[]> {
	return new Promise((resolve, reject) => {
		const keys: string[] = [], cursor = store.openKeyCursor(after === null ? undefined : IDBKeyRange.lowerBound(after, true));
		cursor.onerror = () => reject(cursor.error ?? new Error('Could not inventory restored candidate keys.'));
		cursor.onsuccess = () => {
			const row = cursor.result;
			if (row === null) { resolve(keys); return; }
			if (typeof row.primaryKey === 'string' && row.primaryKey.length > maximum) {
				reject(new RangeError('Restored physical primary key exceeds its key byte budget.')); return;
			}
			if (typeof row.primaryKey === 'string' && !/^[\u0020-\u007e]+$/u.test(row.primaryKey)) {
				reject(new TypeError('Restored physical primary key requires bounded ASCII.')); return;
			}
			if (keys.length >= remaining) { reject(new RangeError('Restored inventory exceeds its expected count.')); return; }
			if (typeof row.primaryKey !== 'string' || (after !== null && row.primaryKey <= after)
				|| (keys.length > 0 && row.primaryKey <= keys[keys.length - 1]!)) {
				reject(new TypeError('Restored candidate requires ordered string primary keys.')); return;
			}
			keys.push(row.primaryKey);
			if (keys.length === PHOTO_CATALOG_RESTORE_AUDIT_PAGE_SIZE_V1) resolve(keys); else row.continue();
		};
	});
}

export async function assertPhotoCatalogRestoreRecordV1(stores: PhotoCatalogRestoreStoresV1, store: string,
	key: string, expected: unknown): Promise<void> {
	assertPhotoCatalogRestoreValueV1(await request(stores[store].get(key)) as unknown, expected);
}
