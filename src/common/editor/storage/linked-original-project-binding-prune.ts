/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LinkedOriginalBinding, LinkedOriginalKind } from './linked-original-binding.ts';
import { validateLinkedOriginalInventoryBinding } from './linked-original-repository-inventory.ts';
import type {
	LinkedOriginalProvisionalRootInventory,
} from './linked-original-provisional-root.ts';
import type { LinkedOriginalLocatorReference } from './linked-original-repository.ts';
import { linkedOriginalBindingKey } from './linked-original-schema.ts';
import type {
	LinkedOriginalTransientBindingReference,
} from './linked-original-transient-binding-reference.ts';

export interface LinkedOriginalProjectBindingPrunePlan {
	readonly bindingDeletionKeys: readonly string[];
	readonly rootDeletionKeys: readonly string[];
	readonly removedReferences: ReadonlyMap<string, LinkedOriginalLocatorReference>;
	readonly settledTransientBindings: readonly LinkedOriginalTransientBindingReference[];
}

interface BindingRow {
	readonly key: string;
	readonly binding: LinkedOriginalBinding;
}

/** Validate the complete memory inventory before planning binding/root deletion. */
export function planMemoryLinkedOriginalProjectBindingPrune(
	records: ReadonlyMap<string, unknown>,
	rootInventory: LinkedOriginalProvisionalRootInventory,
	projectId: string,
	durableSourceKeys: ReadonlySet<string>,
	retainedSourceKeys: ReadonlySet<string>,
	ownedTransientBindings: readonly LinkedOriginalTransientBindingReference[],
	managedKinds: ReadonlySet<LinkedOriginalKind>,
	maximumRecords: number,
	maximumReferences: number,
	maximumReachabilityRoots: number,
): LinkedOriginalProjectBindingPrunePlan {
	const rows: BindingRow[] = [];
	let count = 0;
	for (const [primaryKey, value] of records) {
		count += 1;
		if (count > maximumRecords) {
			throw new RangeError('Linked original project binding inventory exceeds its record limit.');
		}
		const binding = validateLinkedOriginalInventoryBinding(value, primaryKey);
		rows.push(Object.freeze({ key: linkedOriginalBindingKey(binding.projectId, binding.sourceId), binding }));
	}
	return projectBindingPrunePlan(
		rows,
		rootInventory,
		projectId,
		durableSourceKeys,
		retainedSourceKeys,
		ownedTransientBindings,
		managedKinds,
		maximumReferences,
		maximumReachabilityRoots,
	);
}

/** Validate the complete IndexedDB inventory before planning binding/root deletion. */
export async function planStoredLinkedOriginalProjectBindingPrune(
	store: IDBObjectStore,
	rootInventory: LinkedOriginalProvisionalRootInventory,
	projectId: string,
	durableSourceKeys: ReadonlySet<string>,
	retainedSourceKeys: ReadonlySet<string>,
	ownedTransientBindings: readonly LinkedOriginalTransientBindingReference[],
	managedKinds: ReadonlySet<LinkedOriginalKind>,
	maximumRecords: number,
	maximumReferences: number,
	maximumReachabilityRoots: number,
): Promise<LinkedOriginalProjectBindingPrunePlan> {
	const rows = await readStoredBindingRows(store, maximumRecords);
	return projectBindingPrunePlan(
		rows,
		rootInventory,
		projectId,
		durableSourceKeys,
		retainedSourceKeys,
		ownedTransientBindings,
		managedKinds,
		maximumReferences,
		maximumReachabilityRoots,
	);
}

/** Apply a complete two-map deletion plan with compensation on synchronous failure. */
export function applyMemoryLinkedOriginalProjectBindingPrune(
	bindings: Map<string, unknown>,
	roots: Map<string, unknown>,
	plan: LinkedOriginalProjectBindingPrunePlan,
): void {
	const mutations = [
		...plan.bindingDeletionKeys.map((key) => ({ records: bindings, key })),
		...plan.rootDeletionKeys.map((key) => ({ records: roots, key })),
	];
	const before = mutations.map(({ records, key }) => Object.freeze({
		records,
		key,
		had: records.has(key),
		value: records.get(key),
	}));
	try {
		for (const mutation of mutations) {
			if (!mutation.records.delete(mutation.key)) {
				throw new Error('A planned linked original binding/root disappeared before deletion.');
			}
		}
	} catch (error) {
		const failures: unknown[] = [error];
		for (let index = before.length - 1; index >= 0; index -= 1) {
			const prior = before[index];
			if (!prior) continue;
			try {
				if (prior.had) prior.records.set(prior.key, prior.value);
				else prior.records.delete(prior.key);
			} catch (rollbackError) { failures.push(rollbackError); }
		}
		if (failures.length === 1) throw error;
		throw new AggregateError(failures, 'Linked original binding/root deletion rollback failed.');
	}
}

function projectBindingPrunePlan(
	rows: readonly BindingRow[],
	rootInventory: LinkedOriginalProvisionalRootInventory,
	projectId: string,
	durableSourceKeys: ReadonlySet<string>,
	retainedSourceKeysValue: ReadonlySet<string>,
	ownedTransientBindings: readonly LinkedOriginalTransientBindingReference[],
	managedKinds: ReadonlySet<LinkedOriginalKind>,
	maximumReferences: number,
	maximumReachabilityRoots: number,
): LinkedOriginalProjectBindingPrunePlan {
	const retainedSourceKeys = new Set(retainedSourceKeysValue);
	const rootDeletionKeys = new Set(rootInventory.orphanRootKeys);
	const ownedBySource = new Map(ownedTransientBindings.map((owner) => [sourceReferenceKey(owner), owner]));
	for (const { root } of rootInventory.pairs) {
		if (root.projectId !== projectId || !managedKinds.has(root.kind)) continue;
		const sourceKey = sourceReferenceKey(root);
		retainedSourceKeys.add(sourceKey);
		if (retainedSourceKeys.size > maximumReachabilityRoots) {
			throw new RangeError('Linked original project reachability exceeds its aggregate root limit.');
		}
		if (durableSourceKeys.has(sourceKey)
			|| ownedBySource.get(sourceKey)?.bindingToken === root.bindingToken) {
			rootDeletionKeys.add(root.key);
		}
	}

	const bindingDeletionKeys: string[] = [];
	const inventoryReferences = new Map<string, string>();
	const removedReferences = new Map<string, LinkedOriginalLocatorReference>();
	for (const { key, binding } of rows) {
		if (!managedKinds.has(binding.kind)) continue;
		addInventoryReference(inventoryReferences, binding, maximumReferences);
		if (binding.projectId !== projectId
			|| retainedSourceKeys.has(sourceReferenceKey(binding))) continue;
		bindingDeletionKeys.push(key);
		const reference = locatorReference(binding);
		removedReferences.set(locatorReferenceKey(reference), reference);
	}
	return Object.freeze({
		bindingDeletionKeys: Object.freeze(bindingDeletionKeys.sort()),
		rootDeletionKeys: Object.freeze([...rootDeletionKeys].sort()),
		removedReferences,
		settledTransientBindings: Object.freeze([...ownedTransientBindings]),
	});
}

function readStoredBindingRows(
	store: IDBObjectStore,
	maximumRecords: number,
): Promise<readonly BindingRow[]> {
	return new Promise((resolve, reject) => {
		const rows: BindingRow[] = [];
		let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
		try { cursorRequest = store.openCursor(); } catch (error) { reject(error); return; }
		cursorRequest.onerror = () => reject(
			cursorRequest.error || new Error('Could not enumerate linked original project bindings.'),
		);
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) { resolve(Object.freeze(rows)); return; }
			try {
				if (rows.length >= maximumRecords) {
					throw new RangeError('Linked original project binding inventory exceeds its record limit.');
				}
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

function addInventoryReference(
	references: Map<string, string>,
	binding: LinkedOriginalBinding,
	maximumReferences: number,
): void {
	const key = locatorReferenceKey(binding);
	const current = references.get(key);
	if (current !== undefined && current !== binding.locatorRevision) {
		throw new Error('Linked original project binding inventory contains conflicting locator revisions.');
	}
	references.set(key, binding.locatorRevision);
	if (references.size > maximumReferences) {
		throw new RangeError('Linked original project binding inventory exceeds its reference limit.');
	}
}

function locatorReference(binding: LinkedOriginalBinding): LinkedOriginalLocatorReference {
	return Object.freeze({
		kind: binding.kind,
		locatorId: binding.locatorId,
		locatorRevision: binding.locatorRevision,
	});
}

function sourceReferenceKey(value: Pick<LinkedOriginalBinding, 'kind' | 'sourceId'>): string {
	return JSON.stringify([value.kind, value.sourceId]);
}

function locatorReferenceKey(value: Pick<LinkedOriginalBinding, 'kind' | 'locatorId'>): string {
	return JSON.stringify([value.kind, value.locatorId]);
}
