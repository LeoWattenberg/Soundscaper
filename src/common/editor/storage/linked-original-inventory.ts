/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LinkedOriginalBinding, LinkedOriginalKind } from './linked-original-binding.ts';
import { validateLinkedOriginalInventoryBinding } from './linked-original-repository-inventory.ts';
import { linkedOriginalBindingKey } from './linked-original-schema.ts';

export interface LinkedOriginalBindingInventoryRow {
	readonly key: string;
	readonly binding: LinkedOriginalBinding;
}

export interface LinkedOriginalBindingEnumerationErrors {
	readonly enumerationError: string;
	readonly limitError: string;
}

/** Parse the exact non-empty subset of linked-original media kinds managed by a facade. */
export function linkedOriginalManagedKinds(
	value: unknown = ['audio', 'video'],
): ReadonlySet<LinkedOriginalKind> {
	if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
		throw new TypeError('Linked original managed kinds must be a non-empty array.');
	}
	const kinds = new Set<LinkedOriginalKind>();
	for (const kind of value) {
		if (kind !== 'audio' && kind !== 'video') {
			throw new TypeError('Linked original managed kind must be audio or video.');
		}
		if (kinds.has(kind)) throw new Error('Linked original managed kinds contain a duplicate.');
		kinds.add(kind);
	}
	return kinds;
}

/** Enumerate and validate one complete bounded durable binding inventory. */
export function readBoundedLinkedOriginalBindingRows(
	store: IDBObjectStore,
	maximumRecords: number,
	errors: LinkedOriginalBindingEnumerationErrors,
): Promise<readonly LinkedOriginalBindingInventoryRow[]> {
	return new Promise((resolve, reject) => {
		const rows: LinkedOriginalBindingInventoryRow[] = [];
		let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
		try { cursorRequest = store.openCursor(); } catch (error) { reject(error); return; }
		cursorRequest.onerror = () => reject(
			cursorRequest.error || new Error(errors.enumerationError),
		);
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) { resolve(Object.freeze(rows)); return; }
			try {
				if (rows.length >= maximumRecords) throw new RangeError(errors.limitError);
				const binding = validateLinkedOriginalInventoryBinding(cursor.value, cursor.primaryKey);
				rows.push(Object.freeze({
					key: linkedOriginalBindingKey(binding.projectId, binding.sourceId),
					binding,
				}));
				cursor.continue();
			} catch (error) { reject(error); }
		};
	});
}
