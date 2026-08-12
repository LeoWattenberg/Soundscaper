/* SPDX-License-Identifier: AGPL-3.0-only */

import { request, transact } from './indexeddb-backend.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

type KeyValueStoreName = 'settings' | 'analysis';

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

	async delete(key: string): Promise<void> {
		const database = await this.#port.database();
		if (!database) this.#port.memory[this.#storeName].delete(key);
		else await transact(database, this.#storeName, 'readwrite', (stores) => {
			stores[this.#storeName].delete(key);
		});
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
