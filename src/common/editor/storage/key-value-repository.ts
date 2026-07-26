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

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
