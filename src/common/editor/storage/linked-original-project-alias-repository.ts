/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareCodeUnits } from '../code-unit-order.ts';
import {
	legacyLinkedVideoOriginalBindingFromLinkedOriginal,
	normalizeLinkedOriginalBinding,
	type LinkedOriginalBinding,
	type LinkedOriginalKind,
} from './linked-original-binding.ts';
import {
	assertLinkedOriginalProvisionalRootCapacity,
	deleteMemoryLinkedOriginalPairs,
	publishMemoryLinkedOriginalPairs,
} from './linked-original-pair-writer.ts';
import {
	projectOriginalSources,
	type ProjectOriginalSource,
	type ProjectOriginalSources,
} from './linked-original-project-source-shape.ts';
import {
	LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
	linkedOriginalProvisionalRootPairPublication,
	readMemoryLinkedOriginalProvisionalRootInventory,
	readStoredLinkedOriginalProvisionalRootInventory,
} from './linked-original-provisional-root.ts';
import { validateLinkedOriginalInventoryBinding } from './linked-original-repository-inventory.ts';
import {
	MAX_LINKED_ORIGINAL_INVENTORY_RECORDS,
	MAX_LINKED_ORIGINAL_INVENTORY_REFERENCES,
} from './linked-original-repository.ts';
import type { LinkedOriginalSource } from './linked-original-resolver.ts';
import {
	LINKED_ORIGINAL_STORE_NAME,
	linkedOriginalBindingKey,
} from './linked-original-schema.ts';
import { request, transact } from './indexeddb-backend.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export interface LinkedOriginalProjectAliasRepositoryOptions {
	readonly now?: () => Date;
	readonly createBindingToken?: () => string;
	readonly maximumInventoryRecords?: number;
	readonly maximumInventoryReferences?: number;
	/** Narrow compatibility facades only; generic ownership manages both kinds. */
	readonly managedKinds?: readonly LinkedOriginalKind[];
}

interface BindingInventory {
	readonly bindings: readonly LinkedOriginalBinding[];
	readonly bindingKeys: ReadonlySet<string>;
	readonly bindingTokens: ReadonlySet<string>;
	readonly recordCount: number;
}

/** Atomic, pathless binding aliases used when one local project is duplicated. */
export class LinkedOriginalProjectAliasRepository {
	readonly #port: StorageRepositoryPort;
	readonly #now: () => Date;
	readonly #createBindingToken: () => string;
	readonly #maximumInventoryRecords: number;
	readonly #maximumInventoryReferences: number;
	readonly #managedKinds: ReadonlySet<LinkedOriginalKind>;
	readonly #persistLegacyVideo: boolean;

	constructor(
		port: StorageRepositoryPort,
		options: LinkedOriginalProjectAliasRepositoryOptions = {},
	) {
		if (!port || typeof port.database !== 'function' || !port.memory) {
			throw new TypeError('A linked original project-alias storage port is required.');
		}
		if (options.now !== undefined && typeof options.now !== 'function') {
			throw new TypeError('Linked original project-alias now must be a function.');
		}
		if (options.createBindingToken !== undefined && typeof options.createBindingToken !== 'function') {
			throw new TypeError('Linked original project-alias token creation must be a function.');
		}
		this.#port = port;
		this.#now = options.now ?? (() => new Date());
		this.#createBindingToken = options.createBindingToken ?? createSecureBindingToken;
		this.#maximumInventoryRecords = inventoryLimit(
			options.maximumInventoryRecords ?? MAX_LINKED_ORIGINAL_INVENTORY_RECORDS,
			MAX_LINKED_ORIGINAL_INVENTORY_RECORDS,
			'record',
		);
		this.#maximumInventoryReferences = inventoryLimit(
			options.maximumInventoryReferences ?? MAX_LINKED_ORIGINAL_INVENTORY_REFERENCES,
			MAX_LINKED_ORIGINAL_INVENTORY_REFERENCES,
			'exact-reference',
		);
		this.#managedKinds = managedKinds(options.managedKinds);
		this.#persistLegacyVideo = this.#managedKinds.size === 1 && this.#managedKinds.has('video');
	}

	async copyReachableAliases(
		sourceProjectIdValue: string,
		destinationProjectIdValue: string,
		sourcesValue: readonly LinkedOriginalSource[],
	): Promise<readonly LinkedOriginalBinding[]> {
		const sourceProjectId = projectId(sourceProjectIdValue);
		const destinationProjectId = projectId(destinationProjectIdValue);
		if (sourceProjectId === destinationProjectId) {
			throw new Error('Linked original alias source and destination projects must differ.');
		}
		const sources = projectOriginalSources(
			sourcesValue,
			sourceProjectId,
			this.#managedKinds,
			this.#maximumInventoryRecords,
		);
		const database = await this.#port.database();
		if (!database) {
			const roots = this.#port.memory.linkedOriginalProvisionalRoots;
			const rootInventory = readMemoryLinkedOriginalProvisionalRootInventory(
				this.#port.memory.linkedVideoOriginalBindings,
				roots,
				this.#maximumInventoryRecords,
			);
			const inventory = memoryInventory(
				this.#port.memory.linkedVideoOriginalBindings,
					this.#maximumInventoryRecords,
					this.#maximumInventoryReferences,
					this.#managedKinds,
			);
			const aliases = this.#planAliases(inventory, sourceProjectId, destinationProjectId, sources);
			const publications = this.#publications(aliases);
			assertLinkedOriginalProvisionalRootCapacity(
				rootInventory,
				publications.map(({ key }) => key),
				this.#maximumInventoryRecords,
			);
			publishMemoryLinkedOriginalPairs(
				this.#port.memory.linkedVideoOriginalBindings,
				roots,
				publications,
			);
			return aliases;
		}
		return transact(database, [
			LINKED_ORIGINAL_STORE_NAME,
			LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
		], 'readwrite', async (stores) => {
			const bindings = stores[LINKED_ORIGINAL_STORE_NAME];
			const roots = stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME];
			const rootInventory = await readStoredLinkedOriginalProvisionalRootInventory(
				bindings,
				roots,
				this.#maximumInventoryRecords,
			);
			const inventory = await indexedDbInventory(
				bindings,
				this.#maximumInventoryRecords,
				this.#maximumInventoryReferences,
				this.#managedKinds,
			);
			const aliases = this.#planAliases(inventory, sourceProjectId, destinationProjectId, sources);
			const publications = this.#publications(aliases);
			assertLinkedOriginalProvisionalRootCapacity(
				rootInventory,
				publications.map(({ key }) => key),
				this.#maximumInventoryRecords,
			);
			await Promise.all(publications.flatMap((publication) => [
				request(bindings.put(publication.record)),
				request(roots.put(publication.root)),
			]));
			return aliases;
		});
	}

	async rollbackAliases(aliasesValue: readonly LinkedOriginalBinding[]): Promise<void> {
		const aliases = rollbackBindings(aliasesValue, this.#maximumInventoryRecords);
		if (aliases.length === 0) return;
		const database = await this.#port.database();
		if (!database) {
			const records = this.#port.memory.linkedVideoOriginalBindings;
			const roots = this.#port.memory.linkedOriginalProvisionalRoots;
			readMemoryLinkedOriginalProvisionalRootInventory(
				records,
				roots,
				this.#maximumInventoryRecords,
			);
			const inventory = memoryInventory(
				records,
					this.#maximumInventoryRecords,
					this.#maximumInventoryReferences,
					this.#managedKinds,
			);
			const keys = rollbackKeys(inventory, aliases);
			deleteMemoryLinkedOriginalPairs(records, roots, keys);
			return;
		}
		await transact(database, [
			LINKED_ORIGINAL_STORE_NAME,
			LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
		], 'readwrite', async (stores) => {
			const bindings = stores[LINKED_ORIGINAL_STORE_NAME];
			const roots = stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME];
			await readStoredLinkedOriginalProvisionalRootInventory(
				bindings,
				roots,
				this.#maximumInventoryRecords,
			);
			const inventory = await indexedDbInventory(
				bindings,
				this.#maximumInventoryRecords,
				this.#maximumInventoryReferences,
				this.#managedKinds,
			);
			const keys = rollbackKeys(inventory, aliases);
			await Promise.all(keys.flatMap((key) => [
				request(bindings.delete(key)),
				request(roots.delete(key)),
			]));
		});
	}

	#publications(aliases: readonly LinkedOriginalBinding[]) {
		return aliases.map((binding) => linkedOriginalProvisionalRootPairPublication(
			binding,
			this.#persistLegacyVideo
				? legacyLinkedVideoOriginalBindingFromLinkedOriginal(binding)
				: binding,
		));
	}

	#planAliases(
		inventory: BindingInventory,
		sourceProjectId: string,
		destinationProjectId: string,
		sources: ProjectOriginalSources,
	): readonly LinkedOriginalBinding[] {
		if (inventory.bindings.some(({ projectId: owner }) => owner === destinationProjectId)) {
			throw new Error('The linked original alias destination already contains a binding.');
		}
		const projectBindings = inventory.bindings
			.filter((binding) => binding.projectId === sourceProjectId)
			.sort((left, right) => compareCodeUnits(left.sourceId, right.sourceId));
		if (projectBindings.some((binding) => sources.unbindable.has(binding.sourceId))) {
			throw new Error('A linked original binding exists for a source that no longer matches it.');
		}
		const sourceBindings = projectBindings.filter(({ sourceId }) => sources.sources.has(sourceId));
		if (sourceBindings.some((binding) => inventory.bindingKeys.has(
			linkedOriginalBindingKey(destinationProjectId, binding.sourceId),
		))) {
			throw new Error('A linked original alias destination key is already occupied.');
		}
		if (inventory.recordCount + sourceBindings.length > this.#maximumInventoryRecords) {
			throw new RangeError('Linked original alias prospective rows exceed the record limit.');
		}
		for (const binding of sourceBindings) {
			assertSourceMatches(binding, sources.sources.get(binding.sourceId));
		}
		const usedTokens = new Set(inventory.bindingTokens);
		const aliases = sourceBindings.map((binding) => {
			const bindingToken = this.#createBindingToken();
			if (usedTokens.has(bindingToken)) {
				throw new Error('Linked original project-alias token creation repeated an existing fence.');
			}
			const instant = this.#now();
			if (!(instant instanceof Date)) {
				throw new TypeError('Linked original project-alias now must return a Date.');
			}
			const alias = normalizeLinkedOriginalBinding({
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

function assertSourceMatches(
	binding: LinkedOriginalBinding,
	source: ProjectOriginalSource | undefined,
): void {
	if (!source || binding.kind !== source.kind
		|| binding.storageKey !== source.storageKey || binding.mimeType !== source.mimeType
		|| JSON.stringify(binding.sourceShape) !== JSON.stringify(source.sourceShape)) {
		throw new Error('The linked original binding does not exactly match its project source.');
	}
}

function memoryInventory(
	records: ReadonlyMap<string, unknown>,
	maximumRecords: number,
	maximumReferences: number,
	managedKindsValue: ReadonlySet<LinkedOriginalKind>,
): BindingInventory {
	const accumulator = inventoryAccumulator();
	for (const [key, value] of records) {
		addInventoryBinding(
			accumulator,
			value,
			key,
			maximumRecords,
			maximumReferences,
			managedKindsValue,
		);
	}
	return finishInventory(accumulator);
}

function indexedDbInventory(
	store: IDBObjectStore,
	maximumRecords: number,
	maximumReferences: number,
	managedKindsValue: ReadonlySet<LinkedOriginalKind>,
): Promise<BindingInventory> {
	return new Promise((resolve, reject) => {
		const accumulator = inventoryAccumulator();
		let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
		try { cursorRequest = store.openCursor(); }
		catch (error) { reject(error); return; }
		cursorRequest.onerror = () => reject(
			cursorRequest.error || new Error('Could not enumerate linked original project aliases.'),
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
					managedKindsValue,
				);
				cursor.continue();
			} catch (error) { reject(error); }
		};
	});
}

function inventoryAccumulator(): {
	bindings: LinkedOriginalBinding[];
	bindingKeys: Set<string>;
	bindingTokens: Set<string>;
	references: Map<string, string>;
	recordCount: number;
} {
	return {
		bindings: [],
		bindingKeys: new Set(),
		bindingTokens: new Set(),
		references: new Map(),
		recordCount: 0,
	};
}

function addInventoryBinding(
	accumulator: ReturnType<typeof inventoryAccumulator>,
	value: unknown,
	primaryKey: IDBValidKey,
	maximumRecords: number,
	maximumReferences: number,
	managedKindsValue: ReadonlySet<LinkedOriginalKind>,
): void {
	accumulator.recordCount += 1;
	if (accumulator.recordCount > maximumRecords) {
		throw new RangeError('Linked original project-alias inventory exceeds its record limit.');
	}
	const binding = validateLinkedOriginalInventoryBinding(value, primaryKey);
	accumulator.bindingKeys.add(linkedOriginalBindingKey(binding.projectId, binding.sourceId));
	accumulator.bindingTokens.add(binding.bindingToken);
	if (!managedKindsValue.has(binding.kind)) return;
	const referenceKey = JSON.stringify([binding.kind, binding.locatorId]);
	const revision = accumulator.references.get(referenceKey);
	if (revision !== undefined && revision !== binding.locatorRevision) {
		throw new Error('Linked original project-alias inventory contains conflicting locator revisions.');
	}
	accumulator.references.set(referenceKey, binding.locatorRevision);
	if (accumulator.references.size > maximumReferences) {
		throw new RangeError('Linked original project-alias inventory exceeds its exact-reference limit.');
	}
	accumulator.bindings.push(binding);
}

function finishInventory(
	accumulator: ReturnType<typeof inventoryAccumulator>,
): BindingInventory {
	return Object.freeze({
		bindings: Object.freeze(accumulator.bindings),
		bindingKeys: accumulator.bindingKeys,
		bindingTokens: accumulator.bindingTokens,
		recordCount: accumulator.recordCount,
	});
}

function rollbackBindings(
	value: unknown,
	maximumRecords: number,
): readonly LinkedOriginalBinding[] {
	if (!Array.isArray(value)) throw new TypeError('Linked original rollback aliases must be an array.');
	if (value.length > maximumRecords) {
		throw new RangeError('Linked original rollback aliases exceed the record limit.');
	}
	const keys = new Set<string>();
	const aliases = value.map((candidate) => {
		const alias = normalizeLinkedOriginalBinding(candidate);
		const key = linkedOriginalBindingKey(alias.projectId, alias.sourceId);
		if (keys.has(key)) throw new Error('Linked original rollback aliases contain a duplicate binding.');
		keys.add(key);
		return alias;
	});
	return Object.freeze(aliases);
}

function rollbackKeys(
	inventory: BindingInventory,
	aliases: readonly LinkedOriginalBinding[],
): readonly string[] {
	const currentByKey = new Map(inventory.bindings.map((binding) => [
		linkedOriginalBindingKey(binding.projectId, binding.sourceId),
		binding,
	]));
	const keys: string[] = [];
	for (const alias of aliases) {
		const key = linkedOriginalBindingKey(alias.projectId, alias.sourceId);
		const current = currentByKey.get(key);
		if (!current) continue;
		if (current.bindingToken !== alias.bindingToken || !sameBinding(current, alias)) {
			throw new Error('A linked original rollback alias was replaced or its token no longer matches.');
		}
		keys.push(key);
	}
	return Object.freeze(keys);
}

function sameBinding(left: LinkedOriginalBinding, right: LinkedOriginalBinding): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function projectId(value: unknown): string {
	linkedOriginalBindingKey(value, 'project-alias-validation-source');
	return value as string;
}

function inventoryLimit(value: unknown, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`Linked original project-alias ${label} limit is outside its supported bound.`);
	}
	return Number(value);
}

function createSecureBindingToken(): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (!uuid) throw new Error('Secure random generation is required for a linked original project alias.');
	return `binding_${uuid.replaceAll('-', '')}`;
}

function managedKinds(value: unknown = ['audio', 'video']): ReadonlySet<LinkedOriginalKind> {
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
