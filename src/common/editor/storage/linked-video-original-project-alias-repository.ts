/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION,
	normalizeLinkedVideoOriginalBinding,
	type LinkedVideoOriginalBinding,
	type LinkedVideoOriginalSourceShape,
} from './linked-video-original-binding.ts';
import {
	MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_RECORDS,
	MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_REFERENCES,
} from './linked-video-original-repository.ts';
import type { LinkedVideoOriginalSource } from './linked-video-original-resolver.ts';
import {
	LINKED_VIDEO_ORIGINAL_STORE_NAME,
	linkedVideoOriginalBindingKey,
} from './linked-video-original-schema.ts';
import { request, transact } from './indexeddb-backend.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

interface LinkedVideoOriginalProjectAliasRepositoryOptions {
	readonly now?: () => Date;
	readonly createBindingToken?: () => string;
	readonly maximumInventoryRecords?: number;
	readonly maximumInventoryReferences?: number;
}

interface StoredLinkedVideoOriginalBinding {
	readonly key: string;
	readonly projectId: string;
	readonly binding: LinkedVideoOriginalBinding;
}

interface ProjectVideoSource {
	readonly id: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly sourceShape: LinkedVideoOriginalSourceShape;
}

interface BindingInventory {
	readonly bindings: readonly LinkedVideoOriginalBinding[];
	readonly bindingTokens: ReadonlySet<string>;
}

const RECORD_FIELDS = Object.freeze(['key', 'projectId', 'binding'] as const);
const RECORD_FIELD_SET: ReadonlySet<string> = new Set(RECORD_FIELDS);
const SOURCE_FIELDS = Object.freeze([
	'id',
	'kind',
	'storageKey',
	'mimeType',
	'frameCount',
	'sampleRate',
	'width',
	'height',
	'frameRate',
	'videoCodec',
	'audioCodec',
	'hasAudio',
] as const);
const SOURCE_SHAPE_FIELDS = Object.freeze([
	'frameCount',
	'sampleRate',
	'width',
	'height',
	'frameRate',
	'videoCodec',
	'audioCodec',
	'hasAudio',
] as const satisfies readonly (keyof LinkedVideoOriginalSourceShape)[]);
const VALIDATION_LOCATOR_ID = 'locator_validation_token';
const VALIDATION_LOCATOR_REVISION = 'snapshot_validation_token';
const VALIDATION_BINDING_TOKEN = 'binding_validation_token';
const VALIDATION_DIGEST = '0'.repeat(64);
const VALIDATION_INSTANT = '1970-01-01T00:00:00.000Z';

/** Atomic, pathless binding aliases used when one local project is duplicated. */
export class LinkedVideoOriginalProjectAliasRepository {
	readonly #port: StorageRepositoryPort;
	readonly #now: () => Date;
	readonly #createBindingToken: () => string;
	readonly #maximumInventoryRecords: number;
	readonly #maximumInventoryReferences: number;

	constructor(
		port: StorageRepositoryPort,
		options: LinkedVideoOriginalProjectAliasRepositoryOptions = {},
	) {
		if (!port || typeof port.database !== 'function' || !port.memory) {
			throw new TypeError('A linked video original project-alias storage port is required.');
		}
		if (options.now !== undefined && typeof options.now !== 'function') {
			throw new TypeError('Linked video original project-alias now must be a function.');
		}
		if (options.createBindingToken !== undefined && typeof options.createBindingToken !== 'function') {
			throw new TypeError('Linked video original project-alias token creation must be a function.');
		}
		this.#port = port;
		this.#now = options.now ?? (() => new Date());
		this.#createBindingToken = options.createBindingToken ?? createSecureBindingToken;
		this.#maximumInventoryRecords = inventoryLimit(
			options.maximumInventoryRecords ?? MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_RECORDS,
			MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_RECORDS,
			'record',
		);
		this.#maximumInventoryReferences = inventoryLimit(
			options.maximumInventoryReferences ?? MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_REFERENCES,
			MAX_LINKED_VIDEO_ORIGINAL_INVENTORY_REFERENCES,
			'exact-reference',
		);
	}

	async copyReachableAliases(
		sourceProjectIdValue: string,
		destinationProjectIdValue: string,
		sourcesValue: readonly LinkedVideoOriginalSource[],
	): Promise<readonly LinkedVideoOriginalBinding[]> {
		const sourceProjectId = projectId(sourceProjectIdValue);
		const destinationProjectId = projectId(destinationProjectIdValue);
		if (sourceProjectId === destinationProjectId) {
			throw new Error('Linked video original alias source and destination projects must differ.');
		}
		const sources = projectSources(sourcesValue, sourceProjectId, this.#maximumInventoryRecords);
		const database = await this.#port.database();
		if (!database) {
			const inventory = memoryInventory(
				this.#port.memory.linkedVideoOriginalBindings,
				this.#maximumInventoryRecords,
				this.#maximumInventoryReferences,
			);
			const aliases = this.#planAliases(inventory, sourceProjectId, destinationProjectId, sources);
			publishMemoryAliases(this.#port.memory.linkedVideoOriginalBindings, aliases);
			return aliases;
		}
		return transact(database, LINKED_VIDEO_ORIGINAL_STORE_NAME, 'readwrite', async (stores) => {
			const bindings = stores[LINKED_VIDEO_ORIGINAL_STORE_NAME];
			const inventory = await indexedDbInventory(
				bindings,
				this.#maximumInventoryRecords,
				this.#maximumInventoryReferences,
			);
			const aliases = this.#planAliases(inventory, sourceProjectId, destinationProjectId, sources);
			await Promise.all(aliases.map((binding) => request(bindings.put(storedRecord(binding)))));
			return aliases;
		});
	}

	async rollbackAliases(aliasesValue: readonly LinkedVideoOriginalBinding[]): Promise<void> {
		const aliases = rollbackBindings(aliasesValue, this.#maximumInventoryRecords);
		if (aliases.length === 0) return;
		const database = await this.#port.database();
		if (!database) {
			const records = this.#port.memory.linkedVideoOriginalBindings;
			const inventory = memoryInventory(
				records,
				this.#maximumInventoryRecords,
				this.#maximumInventoryReferences,
			);
			const keys = rollbackKeys(inventory, aliases);
			for (const key of keys) records.delete(key);
			return;
		}
		await transact(database, LINKED_VIDEO_ORIGINAL_STORE_NAME, 'readwrite', async (stores) => {
			const bindings = stores[LINKED_VIDEO_ORIGINAL_STORE_NAME];
			const inventory = await indexedDbInventory(
				bindings,
				this.#maximumInventoryRecords,
				this.#maximumInventoryReferences,
			);
			const keys = rollbackKeys(inventory, aliases);
			await Promise.all(keys.map((key) => request(bindings.delete(key))));
		});
	}

	#planAliases(
		inventory: BindingInventory,
		sourceProjectId: string,
		destinationProjectId: string,
		sources: ReadonlyMap<string, ProjectVideoSource>,
	): readonly LinkedVideoOriginalBinding[] {
		if (inventory.bindings.some(({ projectId: owner }) => owner === destinationProjectId)) {
			throw new Error('The linked video original alias destination already contains a binding.');
		}
		const sourceBindings = inventory.bindings
			.filter((binding) => binding.projectId === sourceProjectId && sources.has(binding.sourceId))
			.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
		if (inventory.bindings.length + sourceBindings.length > this.#maximumInventoryRecords) {
			throw new RangeError('Linked video original alias prospective rows exceed the record limit.');
		}
		for (const binding of sourceBindings) assertSourceMatches(binding, sources.get(binding.sourceId));
		const usedTokens = new Set(inventory.bindingTokens);
		const aliases = sourceBindings.map((binding) => {
			const bindingToken = this.#createBindingToken();
			if (usedTokens.has(bindingToken)) {
				throw new Error('Linked video original project-alias token creation repeated an existing fence.');
			}
			const instant = this.#now();
			if (!(instant instanceof Date)) {
				throw new TypeError('Linked video original project-alias now must return a Date.');
			}
			const alias = normalizeLinkedVideoOriginalBinding({
				...binding,
				projectId: destinationProjectId,
				bindingToken,
				boundAt: instant.toISOString(),
			});
			usedTokens.add(alias.bindingToken);
			return alias;
		});
		return Object.freeze(aliases);
	}
}

function projectSources(
	value: unknown,
	projectId: string,
	maximumSources: number,
): ReadonlyMap<string, ProjectVideoSource> {
	if (!Array.isArray(value)) throw new TypeError('Linked video original project sources must be an array.');
	if (value.length > maximumSources) {
		throw new RangeError('Linked video original project sources exceed the record limit.');
	}
	const sources = new Map<string, ProjectVideoSource>();
	for (const candidate of value) {
		const source = projectSource(candidate, projectId);
		if (sources.has(source.id)) {
			throw new Error('Linked video original project sources contain a duplicate source identity.');
		}
		sources.set(source.id, source);
	}
	return sources;
}

function projectSource(value: unknown, projectId: string): ProjectVideoSource {
	const source = plainRecord(value, 'project source');
	const fields = Object.fromEntries(SOURCE_FIELDS.map((field) => [field, dataField(source, field)]));
	if (fields.kind !== 'video') throw new TypeError('A linked video original project source must be video.');
	const binding = normalizeLinkedVideoOriginalBinding({
		schemaVersion: LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION,
		projectId,
		sourceId: fields.id,
		storageKey: fields.storageKey,
		locatorId: VALIDATION_LOCATOR_ID,
		locatorRevision: VALIDATION_LOCATOR_REVISION,
		mimeType: fields.mimeType,
		byteLength: 1,
		sha256: VALIDATION_DIGEST,
		sourceShape: Object.fromEntries(SOURCE_SHAPE_FIELDS.map((field) => [field, fields[field]])),
		bindingToken: VALIDATION_BINDING_TOKEN,
		boundAt: VALIDATION_INSTANT,
	});
	return Object.freeze({
		id: binding.sourceId,
		storageKey: binding.storageKey,
		mimeType: binding.mimeType,
		sourceShape: binding.sourceShape,
	});
}

function assertSourceMatches(
	binding: LinkedVideoOriginalBinding,
	source: ProjectVideoSource | undefined,
): void {
	if (!source || binding.storageKey !== source.storageKey || binding.mimeType !== source.mimeType
		|| SOURCE_SHAPE_FIELDS.some((field) => !Object.is(binding.sourceShape[field], source.sourceShape[field]))) {
		throw new Error('The linked video original binding does not exactly match its project source.');
	}
}

function memoryInventory(
	records: ReadonlyMap<string, unknown>,
	maximumRecords: number,
	maximumReferences: number,
): BindingInventory {
	const accumulator = inventoryAccumulator();
	for (const [key, value] of records) {
		addInventoryBinding(accumulator, value, key, maximumRecords, maximumReferences);
	}
	return finishInventory(accumulator);
}

function indexedDbInventory(
	store: IDBObjectStore,
	maximumRecords: number,
	maximumReferences: number,
): Promise<BindingInventory> {
	return new Promise((resolve, reject) => {
		const accumulator = inventoryAccumulator();
		let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
		try { cursorRequest = store.openCursor(); }
		catch (error) { reject(error); return; }
		cursorRequest.onerror = () => reject(
			cursorRequest.error || new Error('Could not enumerate linked video original project aliases.'),
		);
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) { resolve(finishInventory(accumulator)); return; }
			try {
				addInventoryBinding(
					accumulator,
					cursor.value,
					cursor.primaryKey,
					maximumRecords,
					maximumReferences,
				);
				cursor.continue();
			} catch (error) { reject(error); }
		};
	});
}

function inventoryAccumulator(): {
	bindings: LinkedVideoOriginalBinding[];
	references: Map<string, string>;
} {
	return { bindings: [], references: new Map() };
}

function addInventoryBinding(
	accumulator: ReturnType<typeof inventoryAccumulator>,
	value: unknown,
	primaryKey: IDBValidKey,
	maximumRecords: number,
	maximumReferences: number,
): void {
	if (accumulator.bindings.length >= maximumRecords) {
		throw new RangeError('Linked video original project-alias inventory exceeds its record limit.');
	}
	const binding = inventoryBinding(value, primaryKey);
	const revision = accumulator.references.get(binding.locatorId);
	if (revision !== undefined && revision !== binding.locatorRevision) {
		throw new Error('Linked video original project-alias inventory contains conflicting locator revisions.');
	}
	accumulator.references.set(binding.locatorId, binding.locatorRevision);
	if (accumulator.references.size > maximumReferences) {
		throw new RangeError('Linked video original project-alias inventory exceeds its exact-reference limit.');
	}
	accumulator.bindings.push(binding);
}

function finishInventory(
	accumulator: ReturnType<typeof inventoryAccumulator>,
): BindingInventory {
	return Object.freeze({
		bindings: Object.freeze(accumulator.bindings),
		bindingTokens: new Set(accumulator.bindings.map(({ bindingToken }) => bindingToken)),
	});
}

function inventoryBinding(value: unknown, primaryKey: IDBValidKey): LinkedVideoOriginalBinding {
	const record = closedRecord(value, RECORD_FIELDS, RECORD_FIELD_SET, 'stored binding record');
	const binding = normalizeLinkedVideoOriginalBinding(record.binding);
	const expectedKey = linkedVideoOriginalBindingKey(binding.projectId, binding.sourceId);
	if (record.key !== expectedKey || primaryKey !== expectedKey || record.projectId !== binding.projectId) {
		throw new Error('Stored linked video original project-alias record does not match its authoritative key.');
	}
	return binding;
}

function rollbackBindings(
	value: unknown,
	maximumRecords: number,
): readonly LinkedVideoOriginalBinding[] {
	if (!Array.isArray(value)) throw new TypeError('Linked video original rollback aliases must be an array.');
	if (value.length > maximumRecords) {
		throw new RangeError('Linked video original rollback aliases exceed the record limit.');
	}
	const keys = new Set<string>();
	const aliases = value.map((candidate) => {
		const alias = normalizeLinkedVideoOriginalBinding(candidate);
		const key = linkedVideoOriginalBindingKey(alias.projectId, alias.sourceId);
		if (keys.has(key)) throw new Error('Linked video original rollback aliases contain a duplicate binding.');
		keys.add(key);
		return alias;
	});
	return Object.freeze(aliases);
}

function rollbackKeys(
	inventory: BindingInventory,
	aliases: readonly LinkedVideoOriginalBinding[],
): readonly string[] {
	const currentByKey = new Map(inventory.bindings.map((binding) => [
		linkedVideoOriginalBindingKey(binding.projectId, binding.sourceId),
		binding,
	]));
	const keys: string[] = [];
	for (const alias of aliases) {
		const key = linkedVideoOriginalBindingKey(alias.projectId, alias.sourceId);
		const current = currentByKey.get(key);
		if (!current) continue;
		if (current.bindingToken !== alias.bindingToken || !sameBinding(current, alias)) {
			throw new Error('A linked video original rollback alias was replaced or its token no longer matches.');
		}
		keys.push(key);
	}
	return Object.freeze(keys);
}

function sameBinding(left: LinkedVideoOriginalBinding, right: LinkedVideoOriginalBinding): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function publishMemoryAliases(
	records: Map<string, unknown>,
	aliases: readonly LinkedVideoOriginalBinding[],
): void {
	const published: string[] = [];
	try {
		for (const binding of aliases) {
			const record = storedRecord(binding);
			records.set(record.key, record);
			published.push(record.key);
		}
	} catch (error) {
		for (const key of published) records.delete(key);
		throw error;
	}
}

function storedRecord(binding: LinkedVideoOriginalBinding): StoredLinkedVideoOriginalBinding {
	const key = linkedVideoOriginalBindingKey(binding.projectId, binding.sourceId);
	return Object.freeze({ key, projectId: binding.projectId, binding });
}

function projectId(value: unknown): string {
	linkedVideoOriginalBindingKey(value, 'project-alias-validation-source');
	return value as string;
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`A linked video original ${label} must be an object.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`A linked video original ${label} must be a plain object.`);
	}
	return value as Record<string, unknown>;
}

function dataField(record: Record<string, unknown>, field: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, field);
	if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Linked video original project source ${field} must be an enumerable data field.`);
	}
	return descriptor.value;
}

function closedRecord(
	value: unknown,
	fields: readonly string[],
	fieldSet: ReadonlySet<string>,
	label: string,
): Record<string, unknown> {
	const record = plainRecord(value, label);
	const keys = Reflect.ownKeys(record);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fieldSet.has(key))) {
		throw new TypeError(`A linked video original ${label} contains an unsupported field.`);
	}
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const field of fields) output[field] = dataField(record, field);
	return output;
}

function inventoryLimit(value: unknown, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`Linked video original project-alias ${label} limit is outside its supported bound.`);
	}
	return Number(value);
}

function createSecureBindingToken(): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (!uuid) throw new Error('Secure random generation is required for a linked video original project alias.');
	return `binding_${uuid.replaceAll('-', '')}`;
}
