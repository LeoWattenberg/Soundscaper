/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../code-unit-order.ts';
import {
	normalizeLegacyLinkedVideoOriginalBinding,
	normalizeLinkedOriginalBinding,
	type LegacyLinkedVideoOriginalBinding,
	type LinkedOriginalBinding,
	type LinkedOriginalKind,
} from './linked-original-binding.ts';
import { linkedOriginalBindingKey } from './linked-original-schema.ts';
import {
	LINKED_ORIGINAL_PROVISIONAL_ROOT_PROJECT_INDEX_NAME,
	LINKED_ORIGINAL_PROVISIONAL_ROOT_SCHEMA_VERSION,
	LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
	MAX_LINKED_ORIGINAL_PROVISIONAL_ROOTS,
} from './linked-original-provisional-root-schema.ts';

export {
	LINKED_ORIGINAL_PROVISIONAL_ROOT_PROJECT_INDEX_NAME,
	LINKED_ORIGINAL_PROVISIONAL_ROOT_SCHEMA_VERSION,
	LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
	MAX_LINKED_ORIGINAL_PROVISIONAL_ROOTS,
};

export interface LinkedOriginalProvisionalRoot {
	readonly schemaVersion: typeof LINKED_ORIGINAL_PROVISIONAL_ROOT_SCHEMA_VERSION;
	readonly key: string;
	readonly projectId: string;
	readonly kind: LinkedOriginalKind;
	readonly sourceId: string;
	readonly bindingToken: string;
}

export interface LinkedOriginalProvisionalRootPair {
	readonly root: LinkedOriginalProvisionalRoot;
	readonly binding: LinkedOriginalBinding;
}

export interface LinkedOriginalProvisionalRootInventory {
	readonly pairs: readonly LinkedOriginalProvisionalRootPair[];
	readonly orphanRootKeys: readonly string[];
}

export type PersistedLinkedOriginalBinding =
	| LinkedOriginalBinding
	| LegacyLinkedVideoOriginalBinding;

export interface LinkedOriginalProvisionalRootPairPublication {
	readonly key: string;
	readonly record: Readonly<{
		key: string;
		projectId: string;
		binding: PersistedLinkedOriginalBinding;
	}>;
	readonly root: LinkedOriginalProvisionalRoot;
}

const ROOT_FIELDS = Object.freeze([
	'schemaVersion',
	'key',
	'projectId',
	'kind',
	'sourceId',
	'bindingToken',
] as const);
const ROOT_FIELD_SET: ReadonlySet<string> = new Set(ROOT_FIELDS);
const OPAQUE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]{15,127}$/iu;

/** Closed scalar root tied to one exact product-local linked-original generation. */
export function normalizeLinkedOriginalProvisionalRoot(
	value: unknown,
): LinkedOriginalProvisionalRoot {
	const candidate = closedRootRecord(value);
	if (candidate.schemaVersion !== LINKED_ORIGINAL_PROVISIONAL_ROOT_SCHEMA_VERSION) {
		throw new RangeError('Unsupported linked original provisional-root schema version.');
	}
	const kind = linkedOriginalKind(candidate.kind);
	const projectId = canonicalIdentity(candidate.projectId, 'projectId');
	const sourceId = canonicalIdentity(candidate.sourceId, 'sourceId');
	const key = linkedOriginalBindingKey(projectId, sourceId);
	if (candidate.key !== key) {
		throw new Error('Linked original provisional-root key does not match its project/source identity.');
	}
	return Object.freeze({
		schemaVersion: LINKED_ORIGINAL_PROVISIONAL_ROOT_SCHEMA_VERSION,
		key,
		projectId,
		kind,
		sourceId,
		bindingToken: bindingToken(candidate.bindingToken),
	});
}

export function linkedOriginalProvisionalRoot(
	value: LinkedOriginalBinding,
): LinkedOriginalProvisionalRoot {
	const binding = normalizeLinkedOriginalBinding(value);
	return normalizeLinkedOriginalProvisionalRoot({
		schemaVersion: LINKED_ORIGINAL_PROVISIONAL_ROOT_SCHEMA_VERSION,
		key: linkedOriginalBindingKey(binding.projectId, binding.sourceId),
		projectId: binding.projectId,
		kind: binding.kind,
		sourceId: binding.sourceId,
		bindingToken: binding.bindingToken,
	});
}

export function readMemoryLinkedOriginalProvisionalRootInventory(
	bindings: ReadonlyMap<string, unknown>,
	roots: ReadonlyMap<string, unknown>,
	maximumRecordsValue: number = MAX_LINKED_ORIGINAL_PROVISIONAL_ROOTS,
): LinkedOriginalProvisionalRootInventory {
	const maximumRecords = inventoryLimit(maximumRecordsValue);
	const pairs: LinkedOriginalProvisionalRootPair[] = [];
	const orphanRootKeys: string[] = [];
	let count = 0;
	for (const [key, value] of roots) {
		count = nextInventoryCount(count, maximumRecords);
		const root = storedRoot(value, key);
		const binding = optionalStoredBinding(bindings.get(key), key);
		if (!binding) orphanRootKeys.push(root.key);
		else pairs.push(rootPair(root, binding));
	}
	return frozenInventory(pairs, orphanRootKeys);
}

export function readStoredLinkedOriginalProvisionalRootInventory(
	bindings: IDBObjectStore,
	roots: IDBObjectStore,
	maximumRecordsValue: number = MAX_LINKED_ORIGINAL_PROVISIONAL_ROOTS,
): Promise<LinkedOriginalProvisionalRootInventory> {
	const maximumRecords = inventoryLimit(maximumRecordsValue);
	return new Promise((resolve, reject) => {
		const pairs: LinkedOriginalProvisionalRootPair[] = [];
		const orphanRootKeys: string[] = [];
		let count = 0;
		let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
		try { cursorRequest = roots.openCursor(); } catch (error) { reject(error); return; }
		cursorRequest.onerror = () => reject(
			cursorRequest.error || new Error('Could not enumerate linked original provisional roots.'),
		);
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) {
				resolve(frozenInventory(pairs, orphanRootKeys));
				return;
			}
			let root: LinkedOriginalProvisionalRoot;
			let bindingRequest: IDBRequest<unknown>;
			try {
				count = nextInventoryCount(count, maximumRecords);
				root = storedRoot(cursor.value, cursor.primaryKey);
				bindingRequest = bindings.get(root.key);
			} catch (error) { reject(error); return; }
			bindingRequest.onerror = () => reject(
				bindingRequest.error || new Error('Could not read a provisionally rooted linked original binding.'),
			);
			bindingRequest.onsuccess = () => {
				try {
					const binding = optionalStoredBinding(bindingRequest.result, root.key);
					if (!binding) orphanRootKeys.push(root.key);
					else pairs.push(rootPair(root, binding));
					cursor.continue();
				} catch (error) { reject(error); }
			};
		};
	});
}

/** Build a validated pair for insertion by one caller-owned binding/root transaction. */
export function linkedOriginalProvisionalRootPairPublication(
	bindingValue: LinkedOriginalBinding,
	persistedValue: PersistedLinkedOriginalBinding = bindingValue,
): LinkedOriginalProvisionalRootPairPublication {
	const binding = normalizeLinkedOriginalBinding(bindingValue);
	const persisted = normalizePersistedBinding(persistedValue);
	if (JSON.stringify(normalizeLinkedOriginalBinding(persisted)) !== JSON.stringify(binding)) {
		throw new Error('Persisted linked original binding does not match its logical rooted binding.');
	}
	const key = linkedOriginalBindingKey(binding.projectId, binding.sourceId);
	return Object.freeze({
		key,
		record: Object.freeze({ key, projectId: binding.projectId, binding: persisted }),
		root: linkedOriginalProvisionalRoot(binding),
	});
}

function normalizePersistedBinding(
	value: PersistedLinkedOriginalBinding,
): PersistedLinkedOriginalBinding {
	const binding = normalizeLinkedOriginalBinding(value);
	const descriptor = Object.getOwnPropertyDescriptor(value, 'schemaVersion');
	return descriptor?.value === 1
		? normalizeLegacyLinkedVideoOriginalBinding(value)
		: binding;
}

function rootPair(
	root: LinkedOriginalProvisionalRoot,
	binding: LinkedOriginalBinding,
): LinkedOriginalProvisionalRootPair {
	if (root.projectId !== binding.projectId
		|| root.sourceId !== binding.sourceId
		|| root.kind !== binding.kind
		|| root.bindingToken !== binding.bindingToken) {
		throw new Error('Linked original provisional root does not match its extant binding generation.');
	}
	return Object.freeze({ root, binding });
}

function storedRoot(value: unknown, primaryKey: IDBValidKey): LinkedOriginalProvisionalRoot {
	if (typeof primaryKey !== 'string') {
		throw new Error('Stored linked original provisional root does not have a string primary key.');
	}
	const root = normalizeLinkedOriginalProvisionalRoot(value);
	if (root.key !== primaryKey) {
		throw new Error('Stored linked original provisional root does not match its authoritative key.');
	}
	return root;
}

function optionalStoredBinding(value: unknown, key: string): LinkedOriginalBinding | null {
	return value === null || value === undefined
		? null
		: storedBinding(value, key);
}

function storedBinding(value: unknown, expectedKey: string): LinkedOriginalBinding {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A provisionally rooted linked original stored binding must be an object.');
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('A provisionally rooted linked original stored binding must be a plain object.');
	}
	const fields = new Set(['key', 'projectId', 'binding']);
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.size
		|| keys.some((key) => typeof key !== 'string' || !fields.has(key))) {
		throw new TypeError('A provisionally rooted linked original stored binding contains an unsupported field.');
	}
	const record = value as Record<string, unknown>;
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(record, field);
		if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Provisionally rooted linked original stored binding ${field} must be a data field.`);
		}
		output[field] = descriptor.value;
	}
	if (output.key !== expectedKey) {
		throw new Error('Provisionally rooted linked original binding does not match its authoritative key.');
	}
	const binding = normalizeLinkedOriginalBinding(output.binding);
	if (output.projectId !== binding.projectId
		|| linkedOriginalBindingKey(binding.projectId, binding.sourceId) !== expectedKey) {
		throw new Error('Provisionally rooted linked original binding does not match its authoritative key.');
	}
	return binding;
}

function frozenInventory(
	pairs: LinkedOriginalProvisionalRootPair[],
	orphanRootKeys: string[],
): LinkedOriginalProvisionalRootInventory {
	pairs.sort((left, right) => compareCodeUnits(left.root.key, right.root.key));
	orphanRootKeys.sort(compareCodeUnits);
	return Object.freeze({
		pairs: Object.freeze(pairs),
		orphanRootKeys: Object.freeze(orphanRootKeys),
	});
}

function closedRootRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked original provisional root must be an object.');
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('A linked original provisional root must be a plain object.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== ROOT_FIELDS.length
		|| keys.some((key) => typeof key !== 'string' || !ROOT_FIELD_SET.has(key))) {
		throw new TypeError('A linked original provisional root contains an unsupported field.');
	}
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const field of ROOT_FIELDS) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Linked original provisional root ${field} must be an enumerable data field.`);
		}
		output[field] = descriptor.value;
	}
	return output;
}

function canonicalIdentity(value: unknown, field: string): string {
	linkedOriginalBindingKey(
		field === 'projectId' ? value : 'provisional-root-project-validation',
		field === 'sourceId' ? value : 'provisional-root-source-validation',
	);
	return value as string;
}

function linkedOriginalKind(value: unknown): LinkedOriginalKind {
	if (value !== 'audio' && value !== 'video') {
		throw new TypeError('Linked original provisional-root kind must be audio or video.');
	}
	return value;
}

function bindingToken(value: unknown): string {
	if (typeof value !== 'string' || !OPAQUE_TOKEN_PATTERN.test(value)) {
		throw new TypeError('A valid linked original provisional-root binding token is required.');
	}
	return value;
}

function inventoryLimit(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > MAX_LINKED_ORIGINAL_PROVISIONAL_ROOTS) {
		throw new RangeError(
			'Linked original provisional-root inventory limit must be a positive safe integer no greater than 100,000.',
		);
	}
	return Number(value);
}

function nextInventoryCount(current: number, maximum: number): number {
	const count = current + 1;
	if (count > maximum) {
		throw new RangeError('Linked original provisional-root inventory exceeds its record limit.');
	}
	return count;
}
