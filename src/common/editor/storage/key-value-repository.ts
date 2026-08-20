/* SPDX-License-Identifier: AGPL-3.0-only */

import { readCursorPage, request, transact } from './indexeddb-backend.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

type KeyValueStoreName = 'settings' | 'analysis';
const KEY_VALUE_INVENTORY_PAGE_SIZE = 64;
const MAXIMUM_KEY_VALUE_INVENTORY_RECORDS = 65_536;
const MAXIMUM_KEY_VALUE_PREFIX_RECORDS = 4_096;

export interface KeyValuePrefixRecord {
	readonly key: string;
	readonly projectId: string;
	readonly value: unknown;
}

/** Repository for one named key/value domain. */
export class KeyValueRepository {
	readonly #port: StorageRepositoryPort;
	readonly #storeName: KeyValueStoreName;

	constructor(port: StorageRepositoryPort, storeName: KeyValueStoreName) {
		this.#port = port;
		this.#storeName = storeName;
	}

	async put(key: string, value: unknown): Promise<unknown> {
		const record = { key, value: clone(value) };
		const database = await this.#port.database();
		if (!database) this.#port.memory[this.#storeName].set(key, record);
		else await transact(database, this.#storeName, 'readwrite', (stores) => {
			stores[this.#storeName].put(record);
		});
		return clone(value);
	}

	async putIfAbsent(key: string, value: unknown): Promise<boolean> {
		const record = { key, value: clone(value) };
		const database = await this.#port.database();
		if (!database) {
			if (this.#port.memory[this.#storeName].has(key)) return false;
			this.#port.memory[this.#storeName].set(key, record);
			return true;
		}
		return transact(database, this.#storeName, 'readwrite', async (stores) => {
			const store = stores[this.#storeName];
			if (await request(store.get(key)) !== undefined) return false;
			store.put(record);
			return true;
		});
	}

	/** Atomically create one row only while an exact same-store ownership fence is current. */
	async putIfAbsentWhenCurrent(
		fenceKey: string,
		expectedFence: unknown,
		key: string,
		value: unknown,
	): Promise<boolean> {
		if (fenceKey === key) throw new Error('A conditional key/value creation needs a distinct fence key.');
		const expectedValue = canonicalComparisonValue(expectedFence);
		const record = { key, value: clone(value) };
		const database = await this.#port.database();
		if (!database) {
			if (!sameStoredValue(this.#port.memory[this.#storeName].get(fenceKey), expectedValue)
				|| this.#port.memory[this.#storeName].has(key)) return false;
			this.#port.memory[this.#storeName].set(key, record);
			return true;
		}
		return transact(database, this.#storeName, 'readwrite', async (stores) => {
			const store = stores[this.#storeName];
			if (!sameStoredValue(await request(store.get(fenceKey)), expectedValue)
				|| await request(store.get(key)) !== undefined) return false;
			store.put(record);
			return true;
		});
	}

	/** Atomically create one row while advancing a distinct exact same-store inventory row. */
	async putIfAbsentAndUpdate(
		key: string,
		value: unknown,
		inventoryKey: string,
		expectedInventory: unknown | undefined,
		nextInventory: unknown,
	): Promise<boolean> {
		if (key === inventoryKey) throw new Error('An inventoried key/value creation needs distinct keys.');
		const expectedValue = expectedInventory === undefined
			? undefined
			: canonicalComparisonValue(expectedInventory);
		const record = { key, value: clone(value) };
		const inventoryRecord = { key: inventoryKey, value: clone(nextInventory) };
		const database = await this.#port.database();
		if (!database) {
			const inventory = this.#port.memory[this.#storeName].get(inventoryKey);
			if (this.#port.memory[this.#storeName].has(key)
				|| (expectedValue === undefined
					? inventory !== undefined
					: !sameStoredValue(inventory, expectedValue))) return false;
			this.#port.memory[this.#storeName].set(inventoryKey, inventoryRecord);
			this.#port.memory[this.#storeName].set(key, record);
			return true;
		}
		return transact(database, this.#storeName, 'readwrite', async (stores) => {
			const store = stores[this.#storeName];
			const [inventory, current] = await Promise.all([
				request(store.get(inventoryKey)),
				request(store.get(key)),
			]);
			if (current !== undefined || (expectedValue === undefined
				? inventory !== undefined
				: !sameStoredValue(inventory, expectedValue))) return false;
			store.put(inventoryRecord);
			store.put(record);
			return true;
		});
	}

	/** Atomically replace one exact row while creating a distinct durable intent row. */
	async replaceIfCurrentAndPutIfAbsent(
		key: string,
		expected: unknown,
		replacement: unknown,
		intentKey: string,
		intent: unknown,
	): Promise<boolean> {
		if (key === intentKey) throw new Error('A conditional replacement needs a distinct intent key.');
		const expectedValue = canonicalComparisonValue(expected);
		const replacementRecord = { key, value: clone(replacement) };
		const intentRecord = { key: intentKey, value: clone(intent) };
		const database = await this.#port.database();
		if (!database) {
			if (!sameStoredValue(this.#port.memory[this.#storeName].get(key), expectedValue)
				|| this.#port.memory[this.#storeName].has(intentKey)) return false;
			this.#port.memory[this.#storeName].set(key, replacementRecord);
			this.#port.memory[this.#storeName].set(intentKey, intentRecord);
			return true;
		}
		return transact(database, this.#storeName, 'readwrite', async (stores) => {
			const store = stores[this.#storeName];
			const [current, currentIntent] = await Promise.all([
				request(store.get(key)),
				request(store.get(intentKey)),
			]);
			if (!sameStoredValue(current, expectedValue) || currentIntent !== undefined) return false;
			store.put(replacementRecord);
			store.put(intentRecord);
			return true;
		});
	}

	async replaceIfCurrent(key: string, expected: unknown, replacement: unknown): Promise<boolean> {
		const expectedValue = canonicalComparisonValue(expected);
		const record = { key, value: clone(replacement) };
		const database = await this.#port.database();
		if (!database) {
			const current = this.#port.memory[this.#storeName].get(key);
			if (!sameStoredValue(current, expectedValue)) return false;
			this.#port.memory[this.#storeName].set(key, record);
			return true;
		}
		return transact(database, this.#storeName, 'readwrite', async (stores) => {
			const store = stores[this.#storeName];
			const current = await request(store.get(key));
			if (!sameStoredValue(current, expectedValue)) return false;
			store.put(record);
			return true;
		});
	}

	/** Atomically replace one row only while a distinct exact same-store fence is current. */
	async replaceIfCurrentWhenCurrent(
		fenceKey: string,
		expectedFence: unknown,
		key: string,
		expected: unknown,
		replacement: unknown,
	): Promise<boolean> {
		if (fenceKey === key) throw new Error('A conditional key/value replacement needs a distinct fence key.');
		const expectedFenceValue = canonicalComparisonValue(expectedFence);
		const expectedValue = canonicalComparisonValue(expected);
		const record = { key, value: clone(replacement) };
		const database = await this.#port.database();
		if (!database) {
			if (!sameStoredValue(this.#port.memory[this.#storeName].get(fenceKey), expectedFenceValue)
				|| !sameStoredValue(this.#port.memory[this.#storeName].get(key), expectedValue)) return false;
			this.#port.memory[this.#storeName].set(key, record);
			return true;
		}
		return transact(database, this.#storeName, 'readwrite', async (stores) => {
			const store = stores[this.#storeName];
			if (!sameStoredValue(await request(store.get(fenceKey)), expectedFenceValue)
				|| !sameStoredValue(await request(store.get(key)), expectedValue)) return false;
			store.put(record);
			return true;
		});
	}

	async deleteIfCurrent(key: string, expected: unknown): Promise<boolean> {
		const expectedValue = canonicalComparisonValue(expected);
		const database = await this.#port.database();
		if (!database) {
			const current = this.#port.memory[this.#storeName].get(key);
			if (!sameStoredValue(current, expectedValue)) return false;
			this.#port.memory[this.#storeName].delete(key);
			return true;
		}
		return transact(database, this.#storeName, 'readwrite', async (stores) => {
			const store = stores[this.#storeName];
			const current = await request(store.get(key));
			if (!sameStoredValue(current, expectedValue)) return false;
			store.delete(key);
			return true;
		});
	}

	async get(key: string): Promise<unknown> {
		const database = await this.#port.database();
		const value = !database
			? this.#port.memory[this.#storeName].get(key)
			: await transact(database, this.#storeName, 'readonly', (stores) => (
				request(stores[this.#storeName].get(key))
			));
		const record = value && typeof value === 'object' ? value as { readonly value?: unknown } : null;
		return record ? clone(record.value) : undefined;
	}

	async listByPrefix(prefix: string): Promise<readonly Readonly<KeyValuePrefixRecord>[]> {
		if (typeof prefix !== 'string' || !prefix.length) throw new TypeError('A key/value prefix is required.');
		const database = await this.#port.database();
		const matches: Readonly<KeyValuePrefixRecord>[] = [];
		let scanned = 0;
		if (!database) {
			for (const value of this.#port.memory[this.#storeName].values()) {
				scanned += 1;
				assertInventoryBound(scanned);
				const match = prefixRecord(value, prefix);
				if (match) matches.push(match);
				assertPrefixBound(matches.length);
			}
			return Object.freeze(matches);
		}
		let afterPrimaryKey: IDBValidKey | undefined;
		while (true) {
			const page = await transact(database, this.#storeName, 'readonly', (stores) => (
				readCursorPage<Readonly<{ primaryKey: IDBValidKey; value: unknown }>>(stores[this.#storeName], {
					afterPrimaryKey,
					limit: KEY_VALUE_INVENTORY_PAGE_SIZE,
					project: (value, primaryKey) => Object.freeze({ primaryKey, value }),
				})
			));
			if (!page.length) return Object.freeze(matches);
			afterPrimaryKey = page.at(-1)!.primaryKey;
			for (const { value } of page) {
				scanned += 1;
				assertInventoryBound(scanned);
				const match = prefixRecord(value, prefix);
				if (match) matches.push(match);
				assertPrefixBound(matches.length);
			}
		}
	}

	/** Delete one owned namespace in bounded cursor pages without retaining its values. */
	async deleteByPrefix(prefix: string): Promise<number> {
		if (typeof prefix !== 'string' || !prefix.length) throw new TypeError('A key/value prefix is required.');
		const database = await this.#port.database();
		if (!database) {
			let scanned = 0;
			let deleted = 0;
			for (const key of [...this.#port.memory[this.#storeName].keys()].sort()) {
				scanned += 1;
				assertInventoryBound(scanned);
				if (!key.startsWith(prefix)) continue;
				if (this.#port.memory[this.#storeName].delete(key)) deleted += 1;
			}
			return deleted;
		}
		let afterPrimaryKey: string | undefined;
		let scanned = 0;
		let deleted = 0;
		while (true) {
			const page = await transact(database, this.#storeName, 'readwrite', (stores) => (
				deletePrefixCursorPage(
					stores[this.#storeName],
					prefix,
					afterPrimaryKey,
					KEY_VALUE_INVENTORY_PAGE_SIZE - (afterPrimaryKey === undefined ? 0 : 2),
				)
			));
			scanned += page.scanned;
			deleted += page.deleted;
			assertInventoryBound(scanned);
			if (page.done || !page.lastPrimaryKey) return deleted;
			afterPrimaryKey = page.lastPrimaryKey;
		}
	}

	async delete(key: string): Promise<void> {
		const database = await this.#port.database();
		if (!database) this.#port.memory[this.#storeName].delete(key);
		else await transact(database, this.#storeName, 'readwrite', (stores) => {
			stores[this.#storeName].delete(key);
		});
	}
}

function deletePrefixCursorPage(
	store: IDBObjectStore,
	prefix: string,
	afterPrimaryKey: string | undefined,
	limit: number,
): Promise<Readonly<{
	deleted: number;
	done: boolean;
	lastPrimaryKey: string | null;
	scanned: number;
}>> {
	return new Promise((resolve, reject) => {
		let deleted = 0;
		let scanned = 0;
		let lastPrimaryKey: string | null = null;
		const cursorRequest = store.openCursor();
		cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Could not purge key/value records.'));
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) {
				resolve(Object.freeze({ deleted, done: true, lastPrimaryKey, scanned }));
				return;
			}
			if (typeof cursor.primaryKey !== 'string') {
				reject(new TypeError('A key/value cursor primary key must be a string.'));
				return;
			}
			if (afterPrimaryKey !== undefined && cursor.primaryKey < afterPrimaryKey) {
				cursor.continue(afterPrimaryKey);
				return;
			}
			if (afterPrimaryKey !== undefined && cursor.primaryKey === afterPrimaryKey) {
				cursor.continue();
				return;
			}
			scanned += 1;
			lastPrimaryKey = cursor.primaryKey;
			if (cursor.primaryKey.startsWith(prefix)) {
				store.delete(cursor.primaryKey);
				deleted += 1;
			}
			if (scanned >= limit) {
				resolve(Object.freeze({ deleted, done: false, lastPrimaryKey, scanned }));
				return;
			}
			cursor.continue();
		};
	});
}

function prefixRecord(value: unknown, prefix: string): Readonly<KeyValuePrefixRecord> | null {
	const record = value && typeof value === 'object'
		? value as { readonly key?: unknown; readonly value?: unknown }
		: null;
	if (!record || typeof record.key !== 'string' || !record.key.startsWith(prefix)) return null;
	return Object.freeze({
		key: record.key,
		projectId: decodeKeySuffix(record.key.slice(prefix.length)),
		value: clone(record.value),
	});
}

function decodeKeySuffix(value: string): string {
	try { return decodeURIComponent(value); }
	catch { return value; }
}

function assertInventoryBound(count: number): void {
	if (count > MAXIMUM_KEY_VALUE_INVENTORY_RECORDS) {
		throw new RangeError('Key/value inventory exceeds its complete-scan bound.');
	}
}

function assertPrefixBound(count: number): void {
	if (count > MAXIMUM_KEY_VALUE_PREFIX_RECORDS) {
		throw new RangeError('Key/value prefix inventory exceeds its result bound.');
	}
}

function sameStoredValue(value: unknown, expected: string): boolean {
	if (!value || typeof value !== 'object') return false;
	const record = value as { readonly value?: unknown };
	return canonicalComparisonValue(record.value) === expected;
}

function canonicalComparisonValue(value: unknown): string {
	const serialized = JSON.stringify(value);
	if (serialized === undefined) throw new TypeError('Key/value CAS requires canonical JSON data.');
	return serialized;
}

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
