/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	MAX_INDEXEDDB_CURSOR_PAGE_SIZE,
	readCursorPage,
	transact,
} from './indexeddb-backend.ts';
import type { StorageRecord } from './media-records.ts';

const LEGACY_DERIVATIVE_CACHE_STORE = 'videoDerivatives';

export const DERIVATIVE_CACHE_INVENTORY_PAGE_SIZE = MAX_INDEXEDDB_CURSOR_PAGE_SIZE;

export interface DerivativeCacheInventoryRecord extends StorageRecord {
	readonly key: string;
}

/**
 * Retain only the fields required to account, compare, and dispose of a
 * derivative. The cursor primary key is authoritative so a malformed payload
 * cannot redirect a later compare-and-delete operation.
 */
export function projectDerivativeCacheInventoryRecord(
	value: unknown,
	primaryKey: IDBValidKey,
): DerivativeCacheInventoryRecord {
	if (typeof primaryKey !== 'string' || primaryKey.length === 0) {
		throw new TypeError('A derivative cache cursor primary key is required.');
	}
	if (!value || typeof value !== 'object') {
		throw new TypeError(`Derivative cache record ${primaryKey} is invalid.`);
	}
	const record = value as StorageRecord;
	if (record.key !== primaryKey) {
		throw new Error(`Derivative cache record ${primaryKey} does not match its cursor primary key.`);
	}
	return Object.freeze({
		key: primaryKey,
		sourceId: optionalString(record.sourceId),
		timestamp: optionalFiniteNumber(record.timestamp),
		type: optionalString(record.type),
		storage: optionalString(record.storage),
		path: optionalNullableString(record.path),
		size: optionalFiniteNumber(record.size),
		committedAt: optionalString(record.committedAt),
		cacheToken: optionalString(record.cacheToken),
	});
}

/**
 * Page an inventory-bearing store in fresh transactions. The configurable
 * store allows this bounded scan to backfill a future metadata-only inventory
 * from legacy derivative payload records.
 */
export async function* readDerivativeCacheInventoryPages(
	database: IDBDatabase,
	storeName = LEGACY_DERIVATIVE_CACHE_STORE,
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
	storeName = LEGACY_DERIVATIVE_CACHE_STORE,
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

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function optionalNullableString(value: unknown): string | null | undefined {
	return value === null ? null : optionalString(value);
}

function optionalFiniteNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
