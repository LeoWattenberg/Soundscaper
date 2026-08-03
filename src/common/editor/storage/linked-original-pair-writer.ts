/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	LinkedOriginalProvisionalRootInventory,
	LinkedOriginalProvisionalRootPairPublication,
} from './linked-original-provisional-root.ts';

/** Publish complete binding/root pairs with compensation for process-local map failures. */
export function publishMemoryLinkedOriginalPairs(
	bindings: Map<string, unknown>,
	roots: Map<string, unknown>,
	publications: readonly LinkedOriginalProvisionalRootPairPublication[],
): void {
	const keys = publications.map(({ key }) => key);
	withMemoryPairCompensation(bindings, roots, keys, () => {
		for (const publication of publications) {
			bindings.set(publication.key, publication.record);
			roots.set(publication.key, publication.root);
		}
	});
}

/** Delete complete binding/root pairs with compensation for process-local map failures. */
export function deleteMemoryLinkedOriginalPairs(
	bindings: Map<string, unknown>,
	roots: Map<string, unknown>,
	keys: readonly string[],
): void {
	withMemoryPairCompensation(bindings, roots, keys, () => {
		for (const key of keys) {
			bindings.delete(key);
			roots.delete(key);
		}
	});
}

export function assertLinkedOriginalProvisionalRootCapacity(
	inventory: LinkedOriginalProvisionalRootInventory,
	prospectiveKeys: readonly string[],
	maximumRecords: number,
): void {
	const keys = new Set([
		...inventory.pairs.map(({ root }) => root.key),
		...inventory.orphanRootKeys,
	]);
	for (const key of prospectiveKeys) keys.add(key);
	if (keys.size > maximumRecords) {
		throw new RangeError('Linked original prospective provisional roots exceed the root record limit.');
	}
}

function withMemoryPairCompensation(
	bindings: Map<string, unknown>,
	roots: Map<string, unknown>,
	keysValue: readonly string[],
	operation: () => void,
): void {
	const keys = [...new Set(keysValue)];
	const bindingState = snapshot(bindings, keys);
	const rootState = snapshot(roots, keys);
	try {
		operation();
	} catch (error) {
		restore(bindings, bindingState);
		restore(roots, rootState);
		throw error;
	}
}

interface MemoryEntryState {
	readonly key: string;
	readonly present: boolean;
	readonly value: unknown;
}

function snapshot(records: ReadonlyMap<string, unknown>, keys: readonly string[]): MemoryEntryState[] {
	return keys.map((key) => ({ key, present: records.has(key), value: records.get(key) }));
}

function restore(records: Map<string, unknown>, states: readonly MemoryEntryState[]): void {
	for (const { key, present, value } of states) {
		if (present) Map.prototype.set.call(records, key, value);
		else Map.prototype.delete.call(records, key);
	}
}
