/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	MAX_INDEXEDDB_CURSOR_PAGE_SIZE,
	readCursorPage,
	transact,
} from './indexeddb-backend.ts';
import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	projectDerivativeCacheInventoryRecord,
	type DerivativeCacheInventoryRecord,
} from './derivative-cache-entry.ts';

export const DERIVATIVE_CACHE_INVENTORY_PAGE_SIZE = MAX_INDEXEDDB_CURSOR_PAGE_SIZE;

export {
	projectDerivativeCacheInventoryRecord,
	type DerivativeCacheInventoryRecord,
} from './derivative-cache-entry.ts';

/**
 * Page the metadata-only derivative inventory in fresh transactions. The
 * configurable store remains available to inspect explicitly named schemas.
 */
export async function* readDerivativeCacheInventoryPages(
	database: IDBDatabase,
	storeName = DERIVATIVE_CACHE_ENTRY_STORE_NAME,
): AsyncGenerator<readonly DerivativeCacheInventoryRecord[]> {
	const boundary = await readInventoryBoundary(database, storeName);
	if (!boundary) return;
	let afterPrimaryKey: IDBValidKey | undefined;
	let remainingRecords = boundary.maximumRecords;
	while (remainingRecords > 0) {
		const page = await transact(database, storeName, 'readonly', (stores) => {
			const store = stores[storeName];
			if (!store) throw new Error(`Derivative cache inventory store ${storeName} is unavailable.`);
			return readCursorPage<DerivativeCacheInventoryRecord>(store, {
				afterPrimaryKey,
				maximumPrimaryKey: boundary.maximumPrimaryKey,
				limit: Math.min(DERIVATIVE_CACHE_INVENTORY_PAGE_SIZE, remainingRecords),
				project: projectDerivativeCacheInventoryRecord,
			});
		});
		if (!page.length) return;
		remainingRecords -= page.length;
		afterPrimaryKey = page.at(-1)?.key;
		yield Object.freeze(page);
		if (afterPrimaryKey === boundary.maximumPrimaryKey) return;
	}
}

export async function readDerivativeCacheInventory(
	database: IDBDatabase,
	storeName = DERIVATIVE_CACHE_ENTRY_STORE_NAME,
): Promise<DerivativeCacheInventoryRecord[]> {
	const inventory: DerivativeCacheInventoryRecord[] = [];
	for await (const page of readDerivativeCacheInventoryPages(database, storeName)) {
		inventory.push(...page);
	}
	return inventory;
}

async function readInventoryBoundary(
	database: IDBDatabase,
	storeName: string,
): Promise<Readonly<{ maximumPrimaryKey: string; maximumRecords: number }> | null> {
	return transact(database, storeName, 'readonly', async (stores) => {
		const store = stores[storeName];
		if (!store) throw new Error(`Derivative cache inventory store ${storeName} is unavailable.`);
		const [maximumRecords, lastCursor] = await Promise.all([
			requestCount(store),
			requestLastKey(store),
		]);
		if (maximumRecords === 0 || !lastCursor) return null;
		if (typeof lastCursor.primaryKey !== 'string' || lastCursor.primaryKey.length === 0) {
			throw new TypeError('A derivative cache boundary primary key is required.');
		}
		return Object.freeze({ maximumPrimaryKey: lastCursor.primaryKey, maximumRecords });
	});
}

function requestCount(store: IDBObjectStore): Promise<number> {
	return new Promise((resolve, reject) => {
		const countRequest = store.count();
		countRequest.onsuccess = () => resolve(countRequest.result);
		countRequest.onerror = () => reject(countRequest.error || new Error('Could not count derivative cache records.'));
	});
}

function requestLastKey(store: IDBObjectStore): Promise<IDBCursor | null> {
	return new Promise((resolve, reject) => {
		const cursorRequest = store.openKeyCursor(undefined, 'prev');
		cursorRequest.onsuccess = () => resolve(cursorRequest.result);
		cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Could not bound derivative cache records.'));
	});
}
