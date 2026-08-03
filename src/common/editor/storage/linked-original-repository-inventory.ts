/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeLinkedOriginalBinding,
	type LegacyLinkedVideoOriginalBinding,
	type LinkedOriginalBinding,
} from './linked-original-binding.ts';
import { readStoredLinkedOriginalProvisionalRootInventory } from './linked-original-provisional-root.ts';
import { linkedOriginalBindingKey } from './linked-original-schema.ts';
import { request } from './indexeddb-backend.ts';

export interface LinkedOriginalLocatorReference {
	readonly kind: LinkedOriginalBinding['kind'];
	readonly locatorId: string;
	readonly locatorRevision: string;
}

export function storedLinkedOriginalBinding(
	value: unknown,
	expectedKey: string,
	expectedProjectId: string,
	expectedSourceId: string,
): LinkedOriginalBinding | null {
	if (value === undefined || value === null) return null;
	const binding = validateStoredBindingRecord(value, expectedKey);
	if (binding.projectId !== expectedProjectId || binding.sourceId !== expectedSourceId) {
		throw new Error('Stored linked original binding does not match its authoritative key.');
	}
	return binding;
}

/** Validate one complete inventory row against its authoritative primary key. */
export function validateLinkedOriginalInventoryBinding(
	value: unknown,
	primaryKey: IDBValidKey,
): LinkedOriginalBinding {
	if (typeof primaryKey !== 'string') {
		throw new Error('Stored linked original binding record does not have a string primary key.');
	}
	return validateStoredBindingRecord(value, primaryKey);
}

export function storedLinkedOriginalRecord(
	key: string,
	projectId: string,
	binding: LinkedOriginalBinding | LegacyLinkedVideoOriginalBinding,
): Readonly<{ key: string; projectId: string; binding: typeof binding }> {
	return Object.freeze({ key, projectId, binding });
}

export function memoryLinkedOriginalLocatorReferences(
	records: ReadonlyMap<string, unknown>,
	maximumRecords: number,
	maximumReferences: number,
	kind: LinkedOriginalBinding['kind'] | null = null,
): readonly LinkedOriginalLocatorReference[] {
	const references = new Map<string, Readonly<{
		kind: LinkedOriginalBinding['kind'];
		locatorId: string;
		locatorRevision: string;
	}>>();
	let recordCount = 0;
	for (const [key, value] of records) {
		recordCount = nextInventoryRecordCount(recordCount, maximumRecords);
		const binding = validateLinkedOriginalInventoryBinding(value, key);
		if (kind === null || binding.kind === kind) {
			addLocatorReference(references, binding, maximumReferences);
		}
	}
	return frozenLocatorReferences(references);
}

export function storedLinkedOriginalLocatorReferences(
	store: IDBObjectStore,
	maximumRecords: number,
	maximumReferences: number,
	kind: LinkedOriginalBinding['kind'] | null = null,
): Promise<readonly LinkedOriginalLocatorReference[]> {
	return new Promise((resolve, reject) => {
		const references = new Map<string, Readonly<{
			kind: LinkedOriginalBinding['kind'];
			locatorId: string;
			locatorRevision: string;
		}>>();
		let recordCount = 0;
		let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
		try { cursorRequest = store.openCursor(); } catch (error) { reject(error); return; }
		cursorRequest.onerror = () => reject(
			cursorRequest.error || new Error('Could not enumerate linked original bindings.'),
		);
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) { resolve(frozenLocatorReferences(references)); return; }
			try {
				recordCount = nextInventoryRecordCount(recordCount, maximumRecords);
				const binding = validateLinkedOriginalInventoryBinding(cursor.value, cursor.primaryKey);
				if (kind === null || binding.kind === kind) {
					addLocatorReference(references, binding, maximumReferences);
				}
				cursor.continue();
			} catch (error) { reject(error); }
		};
	});
}

/** Validate and prune one complete durable mixed-kind binding inventory atomically. */
export async function reconcileStoredLinkedOriginalLocatorReferences(
	store: IDBObjectStore,
	rootStore: IDBObjectStore,
	canonicalProjectIds: ReadonlySet<string>,
	maximumRecords: number,
	maximumReferences: number,
): Promise<readonly LinkedOriginalLocatorReference[]> {
	const rootInventory = await readStoredLinkedOriginalProvisionalRootInventory(
		store,
		rootStore,
		maximumRecords,
	);
	return new Promise((resolve, reject) => {
		const references = new Map<string, LinkedOriginalLocatorReference>();
		const reachableReferences = new Set<string>();
		const storageAliases = new Map<string, string>();
		const unreachableKeys: string[] = [];
		let recordCount = 0;
		let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
		try { cursorRequest = store.openCursor(); } catch (error) { reject(error); return; }
		cursorRequest.onerror = () => reject(
			cursorRequest.error || new Error('Could not enumerate linked original bindings.'),
		);
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) {
				const liveReferences = new Map([...references]
					.filter(([key]) => reachableReferences.has(key)));
				let deletions: Promise<unknown>[];
				try {
					deletions = pairAndOrphanDeletions(
						store,
						rootStore,
						unreachableKeys,
						rootInventory.orphanRootKeys,
					);
				}
				catch (error) { reject(error); return; }
				void Promise.all(deletions).then(
					() => resolve(frozenLocatorReferences(liveReferences)),
					reject,
				);
				return;
			}
			try {
				recordCount = nextInventoryRecordCount(recordCount, maximumRecords);
				const binding = validateLinkedOriginalInventoryBinding(cursor.value, cursor.primaryKey);
				assertConsistentStorageAlias(storageAliases, binding);
				addLocatorReference(references, binding, maximumReferences);
				const referenceKey = locatorReferenceKey(binding.kind, binding.locatorId);
				if (canonicalProjectIds.has(binding.projectId)) {
					reachableReferences.add(referenceKey);
				} else {
					unreachableKeys.push(linkedOriginalBindingKey(binding.projectId, binding.sourceId));
				}
				cursor.continue();
			} catch (error) { reject(error); }
		};
	});
}

export async function reconcileStoredLinkedVideoLocatorReferences(
	store: IDBObjectStore,
	rootStore: IDBObjectStore,
	canonicalProjectIds: ReadonlySet<string>,
	maximumRecords: number,
	maximumReferences: number,
): Promise<readonly LinkedOriginalLocatorReference[]> {
	const rootInventory = await readStoredLinkedOriginalProvisionalRootInventory(
		store,
		rootStore,
		maximumRecords,
	);
	return new Promise((resolve, reject) => {
		let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
		try { cursorRequest = store.openCursor(); } catch (error) { reject(error); return; }
		const references = new Map<string, { locatorRevision: string; reachable: boolean }>();
		const unreachableKeys: string[] = [];
		let recordCount = 0;
		cursorRequest.onerror = () => reject(
			cursorRequest.error || new Error('Could not enumerate linked original bindings.'),
		);
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) {
				const liveReferences = Object.freeze([...references]
					.filter(([, reference]) => reference.reachable)
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([locatorId, reference]) => Object.freeze({
						kind: 'video' as const,
						locatorId,
						locatorRevision: reference.locatorRevision,
					})));
				let deletions: Promise<unknown>[];
				try {
					deletions = pairAndOrphanDeletions(
						store,
						rootStore,
						unreachableKeys,
						rootInventory.orphanRootKeys,
					);
				}
				catch (error) { reject(error); return; }
				void Promise.all(deletions).then(() => resolve(liveReferences), reject);
				return;
			}
			try {
				recordCount = nextInventoryRecordCount(recordCount, maximumRecords);
				const binding = validateLinkedOriginalInventoryBinding(cursor.value, cursor.primaryKey);
				if (binding.kind !== 'video') { cursor.continue(); return; }
				const current = references.get(binding.locatorId);
				if (current && current.locatorRevision !== binding.locatorRevision) {
					throw new Error('Linked original binding inventory contains conflicting locator revisions.');
				}
				const reachable = canonicalProjectIds.has(binding.projectId);
				references.set(binding.locatorId, {
					locatorRevision: binding.locatorRevision,
					reachable: reachable || current?.reachable === true,
				});
				if (!reachable) unreachableKeys.push(linkedOriginalBindingKey(
					binding.projectId,
					binding.sourceId,
				));
				if (references.size > maximumReferences) {
					throw new RangeError('Linked original binding inventory exceeds its reference limit.');
				}
				cursor.continue();
			} catch (error) { reject(error); }
		};
	});
}

function pairAndOrphanDeletions(
	bindings: IDBObjectStore,
	roots: IDBObjectStore,
	pairKeys: readonly string[],
	orphanRootKeys: readonly string[],
): Promise<unknown>[] {
	return [
		...pairKeys.map((key) => request(bindings.delete(key))),
		...[...new Set([...pairKeys, ...orphanRootKeys])]
			.map((key) => request(roots.delete(key))),
	];
}

export function memoryLinkedOriginalBindingsByStorageKey(
	records: ReadonlyMap<string, unknown>,
	storageKey: string,
	maximumRecords: number,
): readonly LinkedOriginalBinding[] {
	const bindings: LinkedOriginalBinding[] = [];
	let recordCount = 0;
	for (const [key, value] of records) {
		recordCount = nextInventoryRecordCount(recordCount, maximumRecords);
		const binding = validateLinkedOriginalInventoryBinding(value, key);
		if (binding.storageKey === storageKey) bindings.push(binding);
	}
	return exactStorageAliases(bindings);
}

export function storedLinkedOriginalBindingsByStorageKey(
	store: IDBObjectStore,
	storageKey: string,
	maximumRecords: number,
): Promise<readonly LinkedOriginalBinding[]> {
	return new Promise((resolve, reject) => {
		const bindings: LinkedOriginalBinding[] = [];
		let recordCount = 0;
		let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
		try { cursorRequest = store.openCursor(); } catch (error) { reject(error); return; }
		cursorRequest.onerror = () => reject(
			cursorRequest.error || new Error('Could not enumerate linked original storage aliases.'),
		);
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) {
				try { resolve(exactStorageAliases(bindings)); } catch (error) { reject(error); }
				return;
			}
			try {
				recordCount = nextInventoryRecordCount(recordCount, maximumRecords);
				const binding = validateLinkedOriginalInventoryBinding(cursor.value, cursor.primaryKey);
				if (binding.storageKey === storageKey) bindings.push(binding);
				cursor.continue();
			} catch (error) { reject(error); }
		};
	});
}

function validateStoredBindingRecord(value: unknown, expectedKey: string): LinkedOriginalBinding {
	const record = closedRecord(value);
	if (record.key !== expectedKey) {
		throw new Error('Stored linked original binding record does not match its authoritative key.');
	}
	const binding = normalizeLinkedOriginalBinding(record.binding);
	if (record.projectId !== binding.projectId
		|| linkedOriginalBindingKey(binding.projectId, binding.sourceId) !== expectedKey) {
		throw new Error('Stored linked original binding record does not match its authoritative key.');
	}
	return binding;
}

function closedRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked original stored binding record must be an object.');
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('A linked original stored binding record must be a plain object.');
	}
	const fields = new Set(['key', 'projectId', 'binding']);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.size
		|| keys.some((key) => typeof key !== 'string' || !fields.has(key))) {
		throw new TypeError('A linked original stored binding record contains an unsupported field.');
	}
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Linked original stored binding record ${field} must be a data field.`);
		}
		output[field] = descriptor.value;
	}
	return output;
}

function addLocatorReference(
	references: Map<string, Readonly<{
		kind: LinkedOriginalBinding['kind'];
		locatorId: string;
		locatorRevision: string;
	}>>,
	binding: LinkedOriginalBinding,
	maximumReferences: number,
): void {
	const key = locatorReferenceKey(binding.kind, binding.locatorId);
	const reference = references.get(key);
	if (reference && reference.locatorRevision !== binding.locatorRevision) {
		throw new Error('Linked original binding inventory contains conflicting locator revisions.');
	}
	references.set(key, Object.freeze({
		kind: binding.kind,
		locatorId: binding.locatorId,
		locatorRevision: binding.locatorRevision,
	}));
	if (references.size > maximumReferences) {
		throw new RangeError('Linked original binding inventory exceeds its reference limit.');
	}
}

function locatorReferenceKey(
	kind: LinkedOriginalBinding['kind'],
	locatorId: string,
): string {
	return JSON.stringify([kind, locatorId]);
}

function frozenLocatorReferences(
	references: ReadonlyMap<string, LinkedOriginalLocatorReference>,
): readonly LinkedOriginalLocatorReference[] {
	return Object.freeze([...references.values()]
		.sort((left, right) => (
			left.kind.localeCompare(right.kind) || left.locatorId.localeCompare(right.locatorId)
		)));
}

function exactStorageAliases(bindings: LinkedOriginalBinding[]): readonly LinkedOriginalBinding[] {
	bindings.sort((left, right) => (
		left.projectId.localeCompare(right.projectId) || left.sourceId.localeCompare(right.sourceId)
	));
	const expected = bindings[0];
	if (expected) {
		const exactIdentity = storageAliasIdentity(expected);
		if (bindings.some((binding) => storageAliasIdentity(binding) !== exactIdentity)) {
			throw new Error('Linked original storage aliases conflict in kind, geometry, or content identity.');
		}
	}
	return Object.freeze(bindings);
}

function storageAliasIdentity(binding: LinkedOriginalBinding): string {
	return JSON.stringify([
		binding.kind,
		binding.storageKey,
		binding.locatorId,
		binding.locatorRevision,
		binding.mimeType,
		binding.byteLength,
		binding.sha256,
		binding.sourceShape,
	]);
}

function assertConsistentStorageAlias(
	aliases: Map<string, string>,
	binding: LinkedOriginalBinding,
): void {
	const identity = storageAliasIdentity(binding);
	const expected = aliases.get(binding.storageKey);
	if (expected !== undefined && expected !== identity) {
		throw new Error(
			'Linked original storage alias inventory contains conflicting kind, geometry, or content identity.',
		);
	}
	aliases.set(binding.storageKey, identity);
}

function nextInventoryRecordCount(current: number, maximumRecords: number): number {
	const count = current + 1;
	if (count > maximumRecords) {
		throw new RangeError('Linked original binding inventory exceeds its record limit.');
	}
	return count;
}
