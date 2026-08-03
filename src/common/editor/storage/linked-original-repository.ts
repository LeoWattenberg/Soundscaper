/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	legacyLinkedVideoOriginalBindingFromLinkedOriginal,
	LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	normalizeLegacyLinkedVideoOriginalBindingInput,
	normalizeLinkedOriginalBinding,
	normalizeLinkedOriginalBindingInput,
	type LegacyLinkedVideoOriginalBindingInput,
	type LinkedOriginalBinding,
	type LinkedOriginalBindingInput,
} from './linked-original-binding.ts';
import {
	memoryLinkedOriginalBindingsByStorageKey,
	memoryLinkedOriginalLocatorReferences,
	reconcileStoredLinkedOriginalLocatorReferences,
	reconcileStoredLinkedVideoLocatorReferences,
	storedLinkedOriginalBinding,
	storedLinkedOriginalBindingsByStorageKey,
	storedLinkedOriginalLocatorReferences,
	type LinkedOriginalLocatorReference,
} from './linked-original-repository-inventory.ts';
import {
	assertLinkedOriginalProvisionalRootCapacity,
	deleteMemoryLinkedOriginalPairs,
	publishMemoryLinkedOriginalPairs,
} from './linked-original-pair-writer.ts';
import {
	LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
	linkedOriginalProvisionalRootPairPublication,
	readMemoryLinkedOriginalProvisionalRootInventory,
	readStoredLinkedOriginalProvisionalRootInventory,
} from './linked-original-provisional-root.ts';
import {
	LINKED_ORIGINAL_STORE_NAME,
	linkedOriginalBindingKey,
	linkedOriginalCanonicalIdentity,
} from './linked-original-schema.ts';
import { request, transact } from './indexeddb-backend.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export type { LinkedOriginalLocatorReference } from './linked-original-repository-inventory.ts';

export interface LinkedOriginalRepositoryOptions {
	readonly now?: () => Date;
	readonly createBindingToken?: () => string;
	readonly maximumInventoryRecords?: number;
	readonly maximumInventoryReferences?: number;
}

const OPAQUE_TOKEN_PATTERN = /^[a-z0-9][a-z0-9_-]{15,127}$/iu;
export const MAX_LINKED_ORIGINAL_INVENTORY_RECORDS = 100_000;
export const MAX_LINKED_ORIGINAL_INVENTORY_REFERENCES = 128;
export const MAX_LINKED_ORIGINAL_CANONICAL_PROJECTS = 10_000;

/** Product-local, pathless linked-original declarations with exact CAS fencing. */
export class LinkedOriginalRepository {
	readonly #port: StorageRepositoryPort;
	readonly #now: () => Date;
	readonly #createBindingToken: () => string;
	readonly #maximumInventoryRecords: number;
	readonly #maximumInventoryReferences: number;

	constructor(
		port: StorageRepositoryPort,
		options: LinkedOriginalRepositoryOptions = {},
	) {
		if (!port || typeof port.database !== 'function' || !port.memory) {
			throw new TypeError('A linked original storage port is required.');
		}
		if (options.now !== undefined && typeof options.now !== 'function') {
			throw new TypeError('Linked original repository now must be a function.');
		}
		if (options.createBindingToken !== undefined && typeof options.createBindingToken !== 'function') {
			throw new TypeError('Linked original binding-token creation must be a function.');
		}
		this.#port = port;
		this.#now = options.now ?? (() => new Date());
		this.#createBindingToken = options.createBindingToken ?? createSecureBindingToken;
		this.#maximumInventoryRecords = inventoryLimit(
			options.maximumInventoryRecords ?? MAX_LINKED_ORIGINAL_INVENTORY_RECORDS,
			MAX_LINKED_ORIGINAL_INVENTORY_RECORDS,
			'Linked original inventory record',
		);
		this.#maximumInventoryReferences = inventoryLimit(
			options.maximumInventoryReferences ?? MAX_LINKED_ORIGINAL_INVENTORY_REFERENCES,
			MAX_LINKED_ORIGINAL_INVENTORY_REFERENCES,
			'Linked original inventory reference',
		);
	}

	async get(projectId: string, sourceId: string): Promise<LinkedOriginalBinding | null> {
		const key = linkedOriginalBindingKey(projectId, sourceId);
		const database = await this.#port.database();
		const value = !database
			? this.#records().get(key)
			: await transact(database, LINKED_ORIGINAL_STORE_NAME, 'readonly', (stores) => (
				request(stores[LINKED_ORIGINAL_STORE_NAME].get(key))
			));
		return storedLinkedOriginalBinding(value, key, projectId, sourceId);
	}

	/** Return one complete bounded exact-reference inventory without mutating bindings. */
	async listLocatorReferences(): Promise<readonly LinkedOriginalLocatorReference[]> {
		return this.#listLocatorReferences(null);
	}

	/** Compatibility inventory that validates the mixed store but returns only video locators. */
	listVideoLocatorReferences(): Promise<readonly LinkedOriginalLocatorReference[]> {
		return this.#listLocatorReferences('video');
	}

	async #listLocatorReferences(
		kind: LinkedOriginalBinding['kind'] | null,
	): Promise<readonly LinkedOriginalLocatorReference[]> {
		const database = await this.#port.database();
		if (!database) {
			return memoryLinkedOriginalLocatorReferences(
				this.#records(),
				this.#maximumInventoryRecords,
				this.#maximumInventoryReferences,
				kind,
			);
		}
		return transact(database, LINKED_ORIGINAL_STORE_NAME, 'readonly', (stores) => (
			storedLinkedOriginalLocatorReferences(
				stores[LINKED_ORIGINAL_STORE_NAME],
				this.#maximumInventoryRecords,
				this.#maximumInventoryReferences,
				kind,
			)
		));
	}

	/** Return every exact alias for one storage identity after a complete bounded scan. */
	async listByStorageKey(storageKeyValue: string): Promise<readonly LinkedOriginalBinding[]> {
		const storageKey = linkedOriginalCanonicalIdentity(storageKeyValue, 'storageKey');
		const database = await this.#port.database();
		if (!database) {
			return memoryLinkedOriginalBindingsByStorageKey(
				this.#records(),
				storageKey,
				this.#maximumInventoryRecords,
			);
		}
		return transact(database, LINKED_ORIGINAL_STORE_NAME, 'readonly', (stores) => (
			storedLinkedOriginalBindingsByStorageKey(
				stores[LINKED_ORIGINAL_STORE_NAME],
				storageKey,
				this.#maximumInventoryRecords,
			)
		));
	}

	/** Validate and prune the complete durable mixed-kind binding catalog atomically. */
	async reconcileDurableLocatorReferences(
		canonicalProjectIdsValue: readonly string[],
	): Promise<readonly LinkedOriginalLocatorReference[] | null> {
		const database = await this.#port.database();
		if (!database) return null;
		const canonicalProjectIds = canonicalProjectIdSet(canonicalProjectIdsValue);
		return transact(database, [
			LINKED_ORIGINAL_STORE_NAME,
			LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
		], 'readwrite', (stores) => (
			reconcileStoredLinkedOriginalLocatorReferences(
				stores[LINKED_ORIGINAL_STORE_NAME],
				stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME],
				canonicalProjectIds,
				this.#maximumInventoryRecords,
				this.#maximumInventoryReferences,
			)
		));
	}

	/** Compatibility-only video reconciliation that preserves every audio row. */
	async reconcileDurableVideoLocatorReferences(
		canonicalProjectIdsValue: readonly string[],
	): Promise<readonly LinkedOriginalLocatorReference[] | null> {
		const database = await this.#port.database();
		if (!database) return null;
		const canonicalProjectIds = canonicalProjectIdSet(canonicalProjectIdsValue);
		return transact(database, [
			LINKED_ORIGINAL_STORE_NAME,
			LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
		], 'readwrite', (stores) => (
			reconcileStoredLinkedVideoLocatorReferences(
				stores[LINKED_ORIGINAL_STORE_NAME],
				stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME],
				canonicalProjectIds,
				this.#maximumInventoryRecords,
				this.#maximumInventoryReferences,
			)
		));
	}

	putIfCurrent(
		value: LinkedOriginalBindingInput,
		expectedBindingToken: string | null,
	): Promise<LinkedOriginalBinding | null> {
		return this.#putNormalized(
			normalizeLinkedOriginalBindingInput(value),
			expectedBindingToken,
			false,
		);
	}

	/** Compatibility write used only by the maintained schema-v1 linked-video facade. */
	putLegacyVideoIfCurrent(
		value: LegacyLinkedVideoOriginalBindingInput,
		expectedBindingToken: string | null,
		assertCanPublish?: () => void,
	): Promise<LinkedOriginalBinding | null> {
		const legacy = normalizeLegacyLinkedVideoOriginalBindingInput(value);
		const { schemaVersion: _schemaVersion, ...fields } = legacy;
		return this.#putNormalized(normalizeLinkedOriginalBindingInput({
			schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
			kind: 'video',
			...fields,
		}), expectedBindingToken, true, assertCanPublish);
	}

	async deleteIfCurrent(
		projectId: string,
		sourceId: string,
		expectedBindingToken: string,
	): Promise<boolean> {
		const key = linkedOriginalBindingKey(projectId, sourceId);
		const expected = requiredBindingToken(expectedBindingToken);
		const database = await this.#port.database();
		if (!database) {
			readMemoryLinkedOriginalProvisionalRootInventory(
				this.#records(),
				this.#roots(),
				this.#maximumInventoryRecords,
			);
			const current = storedLinkedOriginalBinding(
				this.#records().get(key),
				key,
				projectId,
				sourceId,
			);
			if (current?.bindingToken !== expected) return false;
			deleteMemoryLinkedOriginalPairs(this.#records(), this.#roots(), [key]);
			return true;
		}
		return transact(database, [
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
			const current = storedLinkedOriginalBinding(
				await request(bindings.get(key)),
				key,
				projectId,
				sourceId,
			);
			if (current?.bindingToken !== expected) return false;
			await Promise.all([request(bindings.delete(key)), request(roots.delete(key))]);
			return true;
		});
	}

	async #putNormalized(
		input: LinkedOriginalBindingInput,
		expectedBindingToken: string | null,
		persistLegacyVideo: boolean,
		assertCanPublish?: () => void,
	): Promise<LinkedOriginalBinding | null> {
		const expected = optionalBindingToken(expectedBindingToken);
		const key = linkedOriginalBindingKey(input.projectId, input.sourceId);
		const database = await this.#port.database();
		if (!database) {
			const records = this.#records();
			const roots = this.#roots();
			const rootInventory = readMemoryLinkedOriginalProvisionalRootInventory(
				records,
				roots,
				this.#maximumInventoryRecords,
			);
			const current = storedLinkedOriginalBinding(
				records.get(key),
				key,
				input.projectId,
				input.sourceId,
			);
			if (!matchesExpectedBinding(current, expected)) return null;
			const binding = this.#nextBinding(input, current);
			assertLinkedOriginalProvisionalRootCapacity(
				rootInventory,
				[key],
				this.#maximumInventoryRecords,
			);
			const publication = linkedOriginalProvisionalRootPairPublication(
				binding,
				persistedBinding(binding, persistLegacyVideo),
			);
			assertCanPublish?.();
			publishMemoryLinkedOriginalPairs(records, roots, [publication]);
			return binding;
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
			const current = storedLinkedOriginalBinding(
				await request(bindings.get(key)),
				key,
				input.projectId,
				input.sourceId,
			);
			if (!matchesExpectedBinding(current, expected)) return null;
			const binding = this.#nextBinding(input, current);
			assertLinkedOriginalProvisionalRootCapacity(
				rootInventory,
				[key],
				this.#maximumInventoryRecords,
			);
			const publication = linkedOriginalProvisionalRootPairPublication(
				binding,
				persistedBinding(binding, persistLegacyVideo),
			);
			assertCanPublish?.();
			await Promise.all([
				request(bindings.put(publication.record)),
				request(roots.put(publication.root)),
			]);
			return binding;
		});
	}

	#nextBinding(
		input: LinkedOriginalBindingInput,
		current: LinkedOriginalBinding | null,
	): LinkedOriginalBinding {
		const bindingToken = this.#createBindingToken();
		if (current?.bindingToken === bindingToken) {
			throw new Error('Linked original binding-token creation repeated the current fence.');
		}
		const now = this.#now();
		if (!(now instanceof Date)) {
			throw new TypeError('Linked original repository now must return a Date.');
		}
		return normalizeLinkedOriginalBinding({
			...input,
			bindingToken,
			boundAt: now.toISOString(),
		});
	}

	#records(): Map<string, unknown> {
		return this.#port.memory.linkedVideoOriginalBindings;
	}

	#roots(): Map<string, unknown> {
		return this.#port.memory.linkedOriginalProvisionalRoots;
	}
}

function persistedBinding(binding: LinkedOriginalBinding, legacyVideo: boolean) {
	return legacyVideo
		? legacyLinkedVideoOriginalBindingFromLinkedOriginal(binding)
		: binding;
}

function matchesExpectedBinding(
	current: LinkedOriginalBinding | null,
	expectedBindingToken: string | null,
): boolean {
	return expectedBindingToken === null
		? current === null
		: current?.bindingToken === expectedBindingToken;
}

function canonicalProjectIdSet(value: unknown): ReadonlySet<string> {
	if (!Array.isArray(value) || value.length > MAX_LINKED_ORIGINAL_CANONICAL_PROJECTS) {
		throw new RangeError('Canonical linked-original project inventory exceeds its project limit.');
	}
	const projectIds = new Set<string>();
	for (const projectId of value) {
		linkedOriginalBindingKey(projectId, 'canonical-project-validation');
		if (projectIds.has(projectId)) {
			throw new Error('Canonical linked-original project inventory contains duplicate project identities.');
		}
		projectIds.add(projectId);
	}
	return projectIds;
}

function optionalBindingToken(value: unknown): string | null {
	return value === null ? null : requiredBindingToken(value);
}

function requiredBindingToken(value: unknown): string {
	if (typeof value !== 'string' || !OPAQUE_TOKEN_PATTERN.test(value)) {
		throw new TypeError('A valid linked original binding CAS token is required.');
	}
	return value;
}

function inventoryLimit(value: unknown, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > maximum) {
		throw new RangeError(`${label} limit must be a positive safe integer no greater than ${maximum}.`);
	}
	return Number(value);
}

function createSecureBindingToken(): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (!uuid) throw new Error('Secure random generation is required for a linked original binding.');
	return `binding_${uuid.replaceAll('-', '')}`;
}
