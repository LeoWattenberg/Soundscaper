/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION,
	normalizeLinkedVideoOriginalBinding,
	type LinkedVideoOriginalBinding,
} from './linked-video-original-binding.ts';
import {
	LINKED_VIDEO_ORIGINAL_STORE_NAME,
	linkedVideoOriginalBindingKey,
} from './linked-video-original-schema.ts';
import { request, transact } from './indexeddb-backend.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export type LinkedVideoOriginalBindingInput = Omit<
	LinkedVideoOriginalBinding,
	'bindingToken' | 'boundAt'
>;

interface LinkedVideoOriginalRepositoryOptions {
	readonly now?: () => Date;
	readonly createBindingToken?: () => string;
	readonly maximumInventoryRecords?: number;
	readonly maximumInventoryReferences?: number;
}

export interface LinkedVideoOriginalLocatorReference {
	readonly locatorId: string;
	readonly locatorRevision: string;
}

interface StoredLinkedVideoOriginalBinding {
	readonly key: string;
	readonly projectId: string;
	readonly binding: LinkedVideoOriginalBinding;
}

const INPUT_FIELDS = Object.freeze([
	'schemaVersion',
	'projectId',
	'sourceId',
	'storageKey',
	'locatorId',
	'locatorRevision',
	'mimeType',
	'byteLength',
	'sha256',
	'sourceShape',
] as const);
const INPUT_FIELD_SET: ReadonlySet<string> = new Set(INPUT_FIELDS);
const RECORD_FIELDS = Object.freeze(['key', 'projectId', 'binding'] as const);
const RECORD_FIELD_SET: ReadonlySet<string> = new Set(RECORD_FIELDS);
const VALIDATION_TOKEN = 'binding_validation_token_0001';
const VALIDATION_INSTANT = '1970-01-01T00:00:00.000Z';
const OPAQUE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]{15,127}$/iu;
export const MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_RECORDS = 100_000;
export const MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_REFERENCES = 128;
export const MAX_LINKED_VIDEO_ORIGINAL_CANONICAL_PROJECTS = 10_000;

/** Product-local, pathless linked-original declarations with exact CAS fencing. */
export class LinkedVideoOriginalRepository {
	readonly #port: StorageRepositoryPort;
	readonly #now: () => Date;
	readonly #createBindingToken: () => string;
	readonly #maximumInventoryRecords: number;
	readonly #maximumInventoryReferences: number;

	constructor(
		port: StorageRepositoryPort,
		options: LinkedVideoOriginalRepositoryOptions = {},
	) {
		if (!port || typeof port.database !== 'function' || !port.memory) {
			throw new TypeError('A linked video original storage port is required.');
		}
		if (options.now !== undefined && typeof options.now !== 'function') {
			throw new TypeError('Linked video original repository now must be a function.');
		}
		if (options.createBindingToken !== undefined && typeof options.createBindingToken !== 'function') {
			throw new TypeError('Linked video original binding-token creation must be a function.');
		}
		this.#port = port;
		this.#now = options.now ?? (() => new Date());
		this.#createBindingToken = options.createBindingToken ?? createSecureBindingToken;
		this.#maximumInventoryRecords = inventoryLimit(
			options.maximumInventoryRecords ?? MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_RECORDS,
			MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_RECORDS,
			'Linked video original inventory record',
		);
		this.#maximumInventoryReferences = inventoryLimit(
			options.maximumInventoryReferences ?? MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_REFERENCES,
			MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_REFERENCES,
			'Linked video original inventory reference',
		);
	}

	async get(projectId: string, sourceId: string): Promise<LinkedVideoOriginalBinding | null> {
		const key = linkedVideoOriginalBindingKey(projectId, sourceId);
		const database = await this.#port.database();
		const value = !database
			? this.#port.memory.linkedVideoOriginalBindings.get(key)
			: await transact(database, LINKED_VIDEO_ORIGINAL_STORE_NAME, 'readonly', (stores) => (
				request(stores[LINKED_VIDEO_ORIGINAL_STORE_NAME].get(key))
			));
		return storedBinding(value, key, projectId, sourceId);
	}

	/** Retire bindings outside one authoritative project catalog and inventory the survivors. */
	async reconcileDurableLocatorReferences(
		canonicalProjectIdsValue: readonly string[],
	): Promise<readonly LinkedVideoOriginalLocatorReference[] | null> {
		const database = await this.#port.database();
		if (!database) return null;
		const canonicalProjectIds = canonicalProjectIdSet(canonicalProjectIdsValue);
		return transact(
			database,
			LINKED_VIDEO_ORIGINAL_STORE_NAME,
			'readwrite',
			(stores) => reconcileDurableLocatorReferences(
				stores[LINKED_VIDEO_ORIGINAL_STORE_NAME],
				canonicalProjectIds,
				this.#maximumInventoryRecords,
				this.#maximumInventoryReferences,
			),
		);
	}

	async putIfCurrent(
		value: LinkedVideoOriginalBindingInput,
		expectedBindingToken: string | null,
	): Promise<LinkedVideoOriginalBinding | null> {
		const input = normalizeBindingInput(value);
		const expected = optionalBindingToken(expectedBindingToken);
		const key = linkedVideoOriginalBindingKey(input.projectId, input.sourceId);
		const database = await this.#port.database();
		if (!database) {
			const current = storedBinding(
				this.#port.memory.linkedVideoOriginalBindings.get(key),
				key,
				input.projectId,
				input.sourceId,
			);
			if (!matchesExpectedBinding(current, expected)) return null;
			const binding = this.#nextBinding(input, current);
			this.#port.memory.linkedVideoOriginalBindings.set(
				key,
				storedRecord(key, binding),
			);
			return binding;
		}
		return transact(database, LINKED_VIDEO_ORIGINAL_STORE_NAME, 'readwrite', async (stores) => {
			const bindings = stores[LINKED_VIDEO_ORIGINAL_STORE_NAME];
			const current = storedBinding(
				await request(bindings.get(key)),
				key,
				input.projectId,
				input.sourceId,
			);
			if (!matchesExpectedBinding(current, expected)) return null;
			const binding = this.#nextBinding(input, current);
			await request(bindings.put(storedRecord(key, binding)));
			return binding;
		});
	}

	async deleteIfCurrent(
		projectId: string,
		sourceId: string,
		expectedBindingToken: string,
	): Promise<boolean> {
		const key = linkedVideoOriginalBindingKey(projectId, sourceId);
		const expected = requiredBindingToken(expectedBindingToken);
		const database = await this.#port.database();
		if (!database) {
			const current = storedBinding(
				this.#port.memory.linkedVideoOriginalBindings.get(key),
				key,
				projectId,
				sourceId,
			);
			if (current?.bindingToken !== expected) return false;
			this.#port.memory.linkedVideoOriginalBindings.delete(key);
			return true;
		}
		return transact(database, LINKED_VIDEO_ORIGINAL_STORE_NAME, 'readwrite', async (stores) => {
			const bindings = stores[LINKED_VIDEO_ORIGINAL_STORE_NAME];
			const current = storedBinding(
				await request(bindings.get(key)),
				key,
				projectId,
				sourceId,
			);
			if (current?.bindingToken !== expected) return false;
			await request(bindings.delete(key));
			return true;
		});
	}

	#nextBinding(
		input: LinkedVideoOriginalBindingInput,
		current: LinkedVideoOriginalBinding | null,
	): LinkedVideoOriginalBinding {
		const bindingToken = this.#createBindingToken();
		if (current?.bindingToken === bindingToken) {
			throw new Error('Linked video original binding-token creation repeated the current fence.');
		}
		const now = this.#now();
		if (!(now instanceof Date)) {
			throw new TypeError('Linked video original repository now must return a Date.');
		}
		return checkedBinding({
			...input,
			bindingToken,
			boundAt: now.toISOString(),
		});
	}
}

function normalizeBindingInput(value: unknown): LinkedVideoOriginalBindingInput {
	const input = closedDataRecord(value, INPUT_FIELDS, INPUT_FIELD_SET, 'binding input');
	const binding = checkedBinding({
		...input,
		bindingToken: VALIDATION_TOKEN,
		boundAt: VALIDATION_INSTANT,
	});
	return Object.freeze({
		schemaVersion: LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION,
		projectId: binding.projectId,
		sourceId: binding.sourceId,
		storageKey: binding.storageKey,
		locatorId: binding.locatorId,
		locatorRevision: binding.locatorRevision,
		mimeType: binding.mimeType,
		byteLength: binding.byteLength,
		sha256: binding.sha256,
		sourceShape: binding.sourceShape,
	});
}

function checkedBinding(value: unknown): LinkedVideoOriginalBinding {
	return normalizeLinkedVideoOriginalBinding(value);
}

function storedBinding(
	value: unknown,
	expectedKey: string,
	expectedProjectId: string,
	expectedSourceId: string,
): LinkedVideoOriginalBinding | null {
	if (value === undefined || value === null) return null;
	const record = closedDataRecord(value, RECORD_FIELDS, RECORD_FIELD_SET, 'stored binding record');
	if (record.key !== expectedKey || record.projectId !== expectedProjectId) {
		throw new Error('Stored linked video original binding record does not match its authoritative key.');
	}
	const binding = checkedBinding(record.binding);
	if (binding.projectId !== expectedProjectId || binding.sourceId !== expectedSourceId
		|| linkedVideoOriginalBindingKey(binding.projectId, binding.sourceId) !== expectedKey) {
		throw new Error('Stored linked video original binding does not match its authoritative key.');
	}
	return binding;
}

function inventoryBinding(value: unknown, primaryKey: IDBValidKey): LinkedVideoOriginalBinding {
	const record = closedDataRecord(value, RECORD_FIELDS, RECORD_FIELD_SET, 'stored binding record');
	const binding = checkedBinding(record.binding);
	const expectedKey = linkedVideoOriginalBindingKey(binding.projectId, binding.sourceId);
	if (record.key !== expectedKey || primaryKey !== expectedKey || record.projectId !== binding.projectId) {
		throw new Error('Stored linked video original binding record does not match its authoritative key.');
	}
	return binding;
}

function reconcileDurableLocatorReferences(
	store: IDBObjectStore,
	canonicalProjectIds: ReadonlySet<string>,
	maximumRecords: number,
	maximumReferences: number,
): Promise<readonly LinkedVideoOriginalLocatorReference[]> {
	return new Promise((resolve, reject) => {
		let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
		try { cursorRequest = store.openCursor(); } catch (error) { reject(error); return; }
		const references = new Map<string, { locatorRevision: string; reachable: boolean }>();
		const unreachableKeys: string[] = [];
		let recordCount = 0;
		cursorRequest.onerror = () => reject(
			cursorRequest.error || new Error('Could not enumerate linked video original bindings.'),
		);
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) {
				const liveReferences = Object.freeze([...references]
					.filter(([, reference]) => reference.reachable)
					.sort(([left], [right]) => left.localeCompare(right))
					.map(([locatorId, reference]) => Object.freeze({
						locatorId,
						locatorRevision: reference.locatorRevision,
					})));
				let deletions: Promise<unknown>[];
				try { deletions = unreachableKeys.map((key) => request(store.delete(key))); }
				catch (error) { reject(error); return; }
				void Promise.all(deletions).then(() => resolve(liveReferences), reject);
				return;
			}
			try {
				recordCount += 1;
				if (recordCount > maximumRecords) {
					throw new RangeError('Linked video original binding inventory exceeds its record limit.');
				}
				const binding = inventoryBinding(cursor.value, cursor.primaryKey);
				const current = references.get(binding.locatorId);
				if (current && current.locatorRevision !== binding.locatorRevision) {
					throw new Error('Linked video original binding inventory contains conflicting locator revisions.');
				}
				const reachable = canonicalProjectIds.has(binding.projectId);
				references.set(binding.locatorId, {
					locatorRevision: binding.locatorRevision,
					reachable: reachable || current?.reachable === true,
				});
				if (!reachable) unreachableKeys.push(linkedVideoOriginalBindingKey(
					binding.projectId,
					binding.sourceId,
				));
				if (references.size > maximumReferences) {
					throw new RangeError('Linked video original binding inventory exceeds its reference limit.');
				}
				cursor.continue();
			} catch (error) { reject(error); }
		};
	});
}

function canonicalProjectIdSet(value: unknown): ReadonlySet<string> {
	if (!Array.isArray(value) || value.length > MAX_LINKED_VIDEO_ORIGINAL_CANONICAL_PROJECTS) {
		throw new RangeError('Canonical linked-video project inventory exceeds its project limit.');
	}
	const projectIds = new Set<string>();
	for (const projectId of value) {
		linkedVideoOriginalBindingKey(projectId, 'canonical-project-validation');
		if (projectIds.has(projectId)) {
			throw new Error('Canonical linked-video project inventory contains duplicate project identities.');
		}
		projectIds.add(projectId);
	}
	return projectIds;
}

function storedRecord(
	key: string,
	binding: LinkedVideoOriginalBinding,
): StoredLinkedVideoOriginalBinding {
	return Object.freeze({ key, projectId: binding.projectId, binding });
}

function matchesExpectedBinding(
	current: LinkedVideoOriginalBinding | null,
	expectedBindingToken: string | null,
): boolean {
	return expectedBindingToken === null
		? current === null
		: current?.bindingToken === expectedBindingToken;
}

function optionalBindingToken(value: unknown): string | null {
	return value === null ? null : requiredBindingToken(value);
}

function requiredBindingToken(value: unknown): string {
	if (typeof value !== 'string' || !OPAQUE_TOKEN_PATTERN.test(value)) {
		throw new TypeError('A valid linked video original binding CAS token is required.');
	}
	return value;
}

function inventoryLimit(value: unknown, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`${label} limit must be a positive safe integer no greater than ${maximum}.`);
	}
	return Number(value);
}

function closedDataRecord(
	value: unknown,
	fields: readonly string[],
	fieldSet: ReadonlySet<string>,
	label: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`A linked video original ${label} must be an object.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`A linked video original ${label} must be a plain object.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fieldSet.has(key))) {
		throw new TypeError(`A linked video original ${label} contains an unsupported field.`);
	}
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Linked video original ${label} ${field} must be an enumerable data field.`);
		}
		output[field] = descriptor.value;
	}
	return output;
}

function createSecureBindingToken(): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (!uuid) throw new Error('Secure random generation is required for a linked video original binding.');
	return `binding_${uuid.replaceAll('-', '')}`;
}
