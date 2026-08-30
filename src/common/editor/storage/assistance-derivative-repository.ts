/* SPDX-License-Identifier: AGPL-3.0-only */

/** Project-isolated, disposable storage for reproducible Milestone 7 assistance outputs. */

import { validateAssistanceWorkflow } from '../assistance/workflow.ts';
import { compareCodeUnits } from '../code-unit-order.ts';
import {
	ASSISTANCE_DERIVATIVE_INVENTORY_KEY,
	ASSISTANCE_DERIVATIVE_KEY_PREFIX,
	ASSISTANCE_DERIVATIVE_KINDS,
	ASSISTANCE_DERIVATIVE_MAXIMUM_ENTRIES,
	ASSISTANCE_DERIVATIVE_RECORD_VERSION,
	ASSISTANCE_DERIVATIVE_SCHEMA_VERSION,
	assistanceDerivativeBatchEntries,
	assistanceDerivativeEvictionRecord,
	assistanceDerivativeInventory,
	assistanceDerivativeInventoryEntry,
	assistanceDerivativeInventoryEntriesWith,
	assistanceDerivativeInventoryWithEntry,
	assistanceDerivativeInventoryWithoutKey,
	assistanceDerivativeKind,
	assistanceDerivativeKinds,
	assistanceDerivativeProjectKeyPrefix,
	assistanceDerivativeRecordView,
	assistanceDerivativeTimestamp,
	createAssistanceDerivativeIdentityV1,
	createAssistanceDerivativeRecord,
	normalizeAssistanceDerivativeInventoryOrNull,
	normalizeAssistanceDerivativeRecordOrNull,
	sameAssistanceDerivativeInventoryEntry,
	sameAssistanceDerivativePayload,
	type AssistanceDerivativeBatchEntryV1,
	type AssistanceDerivativeIdentityV1,
	type AssistanceDerivativeInventoryEntryV1,
	type AssistanceDerivativeInventoryV1,
	type AssistanceDerivativeKind,
	type AssistanceDerivativePayloadV1,
	type AssistanceDerivativeRecordV1,
} from './assistance-derivative-codec.ts';
import {
	isAssistanceDerivativeKeyValuePort,
	requireAtomicAssistanceDerivativeKeyValuePort,
	type AssistanceDerivativeKeyValuePort,
	type AtomicAssistanceDerivativeKeyValuePort,
} from './assistance-derivative-key-value-port.ts';
import {
	DEFAULT_DERIVATIVE_CACHE_LIMITS,
	normalizeDerivativeCacheLimits,
	planDerivativeCacheEviction,
	type DerivativeCacheLimits,
	type NormalizedDerivativeCacheLimits,
} from './derivative-cache-policy.ts';
import { KeyValueRepository, type KeyValuePrefixRecord } from './key-value-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export {
	ASSISTANCE_DERIVATIVE_KEY_PREFIX,
	ASSISTANCE_DERIVATIVE_KINDS,
	ASSISTANCE_DERIVATIVE_MAXIMUM_ENTRIES,
	ASSISTANCE_DERIVATIVE_RECORD_VERSION,
	ASSISTANCE_DERIVATIVE_SCHEMA_VERSION,
	createAssistanceDerivativeIdentityV1,
};
export type {
	AssistanceDerivativeBatchEntryV1,
	AssistanceDerivativeIdentityV1,
	AssistanceDerivativeKind,
	AssistanceDerivativePayloadV1,
	AssistanceDerivativeRecordV1,
};
export type { AssistanceDerivativeKeyValuePort } from './assistance-derivative-key-value-port.ts';

export type AssistanceDerivativeBatchGuard = () => PromiseLike<void> | void;

export interface AssistanceDerivativeRepositoryOptions {
	readonly limits?: Readonly<Pick<
		DerivativeCacheLimits,
		'maximumBytes' | 'maximumEntries' | 'maximumAgeMs'
	>>;
	readonly now?: () => number;
}

interface InventoryState {
	readonly value: unknown;
	readonly inventory: AssistanceDerivativeInventoryV1;
}

interface PublishedRecord {
	readonly record: AssistanceDerivativeRecordV1;
	readonly inserted: boolean;
}

const DEFAULT_LIMITS: NormalizedDerivativeCacheLimits = Object.freeze({
	...DEFAULT_DERIVATIVE_CACHE_LIMITS,
	maximumEntries: ASSISTANCE_DERIVATIVE_MAXIMUM_ENTRIES,
});
const MAXIMUM_CAS_ATTEMPTS = 32;
const READ_CURRENT = Symbol('read-current-assistance-derivative');

export class AssistanceDerivativeRepository {
	readonly #values: AtomicAssistanceDerivativeKeyValuePort;
	readonly #limits: NormalizedDerivativeCacheLimits;
	readonly #now: () => number;
	#operations: Promise<unknown> = Promise.resolve();

	constructor(
		portOrValues: StorageRepositoryPort | AssistanceDerivativeKeyValuePort,
		options: Readonly<AssistanceDerivativeRepositoryOptions> = {},
	) {
		const values = isAssistanceDerivativeKeyValuePort(portOrValues)
			? portOrValues
			: new KeyValueRepository(portOrValues, 'analysis');
		this.#values = requireAtomicAssistanceDerivativeKeyValuePort(values);
		this.#limits = normalizeDerivativeCacheLimits(options.limits ?? DEFAULT_LIMITS);
		if (this.#limits.maximumEntries > ASSISTANCE_DERIVATIVE_MAXIMUM_ENTRIES) {
			throw new RangeError(
				`Assistance derivative maximumEntries cannot exceed ${String(ASSISTANCE_DERIVATIVE_MAXIMUM_ENTRIES)}.`,
			);
		}
		this.#now = options.now ?? Date.now;
	}

	save(
		workflowValue: unknown,
		kindValue: unknown,
		payloadValue: AssistanceDerivativePayloadV1,
	): Promise<AssistanceDerivativeRecordV1> {
		return this.#serialize(async () => (
			await this.#saveBatch(workflowValue, [{
				kind: assistanceDerivativeKind(kindValue), payload: payloadValue,
			}])
		)[0]!);
	}

	saveBatch(
		workflowValue: unknown,
		entriesValue: readonly AssistanceDerivativeBatchEntryV1[],
		guardValue?: AssistanceDerivativeBatchGuard,
	): Promise<readonly AssistanceDerivativeRecordV1[]> {
		return this.#serialize(() => this.#saveBatch(workflowValue, entriesValue, guardValue));
	}

	load(
		workflowValue: unknown,
		kindValue: unknown,
	): Promise<AssistanceDerivativeRecordV1 | null> {
		return this.#serialize(() => this.#load(workflowValue, kindValue));
	}

	listProject(
		projectIdValue: string,
		kindsValue: readonly AssistanceDerivativeKind[] = ASSISTANCE_DERIVATIVE_KINDS,
	): Promise<readonly AssistanceDerivativeRecordV1[]> {
		return this.#serialize(() => this.#listProject(projectIdValue, kindsValue));
	}

	purgeProject(projectIdValue: string): Promise<number> {
		const prefix = assistanceDerivativeProjectKeyPrefix(projectIdValue);
		return this.#serialize(() => this.#deleteRows(prefix));
	}

	purge(): Promise<number> {
		return this.#serialize(() => this.#deleteRows(ASSISTANCE_DERIVATIVE_KEY_PREFIX));
	}

	async #saveBatch(
		workflowValue: unknown,
		entriesValue: readonly AssistanceDerivativeBatchEntryV1[],
		guardValue?: AssistanceDerivativeBatchGuard,
	): Promise<readonly AssistanceDerivativeRecordV1[]> {
		const workflow = validateAssistanceWorkflow(workflowValue);
		const entries = assistanceDerivativeBatchEntries(entriesValue);
		if (guardValue !== undefined && typeof guardValue !== 'function') {
			throw new TypeError('An assistance derivative batch guard must be callable.');
		}
		const records = entries.map(({ kind, payload }) => createAssistanceDerivativeRecord(
			createAssistanceDerivativeIdentityV1(workflow, kind), payload, this.#timestamp(),
		));
		for (const record of records) assertFits(record.payloadByteLength, this.#limits);
		const protectedKeys = new Set(records.map(({ key }) => key));
		const inserted: AssistanceDerivativeRecordV1[] = [];
		const settled: AssistanceDerivativeRecordV1[] = [];
		try {
			for (const record of records) {
				const published = await this.#publish(record, protectedKeys);
				if (published.inserted) inserted.push(record);
				settled.push(published.record);
			}
			await guardValue?.();
			if (!await this.#maintain(protectedKeys)) {
				throw new RangeError('The assistance derivative cannot fit within its configured limits.');
			}
		} catch (error) {
			let rollbackFailed = false;
			for (const record of inserted.reverse()) {
				try {
					const deleted = await this.#retireKey(record.key, record);
					if (!deleted && await this.#values.get(record.key) !== undefined) rollbackFailed = true;
				} catch {
					rollbackFailed = true;
				}
			}
			if (rollbackFailed) throw new AggregateError(
				[error], 'The assistance derivative batch rollback could not settle every inserted row.',
			);
			throw error;
		}
		return Object.freeze(settled.map(assistanceDerivativeRecordView));
	}

	async #publish(
		record: AssistanceDerivativeRecordV1,
		protectedKeys: ReadonlySet<string>,
	): Promise<PublishedRecord> {
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const existingValue = await this.#values.get(record.key);
			if (existingValue !== undefined) {
				const existing = normalizeAssistanceDerivativeRecordOrNull(existingValue, record);
				if (!existing) {
					if (!await this.#retireKey(record.key, existingValue)) {
						throw new Error('The corrupt assistance derivative changed during repair.');
					}
					continue;
				}
				if (!sameAssistanceDerivativePayload(existing, record)) throw new Error(
					'A deterministic assistance derivative cache identity disagrees with its payload.',
				);
				if (await this.#retainExisting(existing, existingValue, protectedKeys)) {
					return Object.freeze({ record: existing, inserted: false });
				}
				continue;
			}
			const entry = assistanceDerivativeInventoryEntry(record);
			if (!await this.#prepareIncoming([entry], protectedKeys)) {
				throw new RangeError('The assistance derivative cannot fit within its configured limits.');
			}
			const state = await this.#inventory();
			const hypothetical = assistanceDerivativeInventoryEntriesWith(state.inventory, [entry]);
			if (this.#evictionKeys(hypothetical).size > 0) continue;
			let next: AssistanceDerivativeInventoryV1;
			try {
				next = assistanceDerivativeInventoryWithEntry(state.inventory, entry);
			} catch (error) {
				if (error instanceof RangeError) continue;
				throw error;
			}
			try {
				if (await this.#values.putIfAbsentAndUpdate(
					record.key, record, ASSISTANCE_DERIVATIVE_INVENTORY_KEY, state.value, next,
				)) return Object.freeze({ record, inserted: true });
			} catch (error) {
				const recoveredValue = await this.#values.get(record.key);
				const recovered = normalizeAssistanceDerivativeRecordOrNull(recoveredValue, record);
				if (recovered && sameAssistanceDerivativePayload(recovered, record)
					&& await this.#ensureInventoryEntry(recovered, recoveredValue, protectedKeys)) {
					return Object.freeze({ record: recovered, inserted: true });
				}
				throw error;
			}
		}
		throw new Error('Assistance derivative publication exceeded its bounded CAS retry limit.');
	}

	async #retainExisting(
		record: AssistanceDerivativeRecordV1,
		value: unknown,
		protectedKeys: ReadonlySet<string>,
	): Promise<boolean> {
		if (!this.#recordCurrent(record)
			|| !await this.#ensureInventoryEntry(record, value, protectedKeys)
			|| !await this.#maintain(protectedKeys)) {
			await this.#retireKey(record.key, value);
			return false;
		}
		return true;
	}

	async #load(
		workflowValue: unknown,
		kindValue: unknown,
	): Promise<AssistanceDerivativeRecordV1 | null> {
		const identity = createAssistanceDerivativeIdentityV1(workflowValue, kindValue);
		const value = await this.#values.get(identity.key);
		if (value === undefined) return null;
		const record = normalizeAssistanceDerivativeRecordOrNull(value, identity);
		if (!record || !this.#recordCurrent(record)) {
			await this.#retireKey(identity.key, value);
			return null;
		}
		const protectedKeys = new Set([record.key]);
		if (!await this.#ensureInventoryEntry(record, value, protectedKeys)
			|| !await this.#maintain(protectedKeys)) return null;
		return assistanceDerivativeRecordView(record);
	}

	async #listProject(
		projectIdValue: string,
		kindsValue: readonly AssistanceDerivativeKind[],
	): Promise<readonly AssistanceDerivativeRecordV1[]> {
		const prefix = assistanceDerivativeProjectKeyPrefix(projectIdValue);
		const kinds = assistanceDerivativeKinds(kindsValue);
		await this.#maintain();
		const state = await this.#inventory();
		const entries = state.inventory.entries.filter(
			(entry) => entry.key.startsWith(prefix) && kinds.has(entry.kind),
		);
		const records: AssistanceDerivativeRecordV1[] = [];
		for (const entry of entries) {
			const value = await this.#values.get(entry.key);
			if (value === undefined) {
				await this.#retireKey(entry.key);
				continue;
			}
			const record = normalizeAssistanceDerivativeRecordOrNull(value);
			if (!record || record.key !== entry.key || !this.#recordCurrent(record)) {
				await this.#retireKey(entry.key, value);
				continue;
			}
			const actualEntry = assistanceDerivativeInventoryEntry(record);
			if (!sameAssistanceDerivativeInventoryEntry(actualEntry, entry)
				&& !await this.#ensureInventoryEntry(record, value, new Set([record.key]))) continue;
			if (kinds.has(record.kind)) records.push(record);
		}
		records.sort((left, right) => ASSISTANCE_DERIVATIVE_KINDS.indexOf(left.kind)
			- ASSISTANCE_DERIVATIVE_KINDS.indexOf(right.kind)
			|| compareCodeUnits(left.identitySha256, right.identitySha256));
		return Object.freeze(records.map(assistanceDerivativeRecordView));
	}

	async #ensureInventoryEntry(
		record: AssistanceDerivativeRecordV1,
		value: unknown,
		protectedKeys: ReadonlySet<string>,
	): Promise<boolean> {
		const entry = assistanceDerivativeInventoryEntry(record);
		if (!await this.#prepareIncoming([entry], protectedKeys)) return false;
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const state = await this.#inventory();
			const current = state.inventory.entries.find(({ key }) => key === record.key);
			if (current && sameAssistanceDerivativeInventoryEntry(current, entry)) return true;
			if (this.#evictionKeys(
				assistanceDerivativeInventoryEntriesWith(state.inventory, [entry]),
			).size > 0) {
				if (!await this.#prepareIncoming([entry], protectedKeys)) return false;
				continue;
			}
			let next: AssistanceDerivativeInventoryV1;
			try {
				next = assistanceDerivativeInventoryWithEntry(state.inventory, entry);
			} catch (error) {
				if (error instanceof RangeError) continue;
				throw error;
			}
			if (await this.#values.replaceIfCurrentWhenCurrent(
				record.key, value,
				ASSISTANCE_DERIVATIVE_INVENTORY_KEY, state.value, next,
			)) return true;
			if (await this.#values.get(record.key) === undefined) return false;
		}
		return false;
	}

	async #prepareIncoming(
		entries: readonly AssistanceDerivativeInventoryEntryV1[],
		protectedKeys: ReadonlySet<string>,
	): Promise<boolean> {
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const state = await this.#inventory();
			const removalKeys = this.#evictionKeys(
				assistanceDerivativeInventoryEntriesWith(state.inventory, entries),
			);
			if ([...removalKeys].some((key) => protectedKeys.has(key))) return false;
			if (removalKeys.size === 0) return true;
			await this.#retireInventoryEntries(
				state.inventory.entries.filter(({ key }) => removalKeys.has(key)),
			);
		}
		throw new Error('Assistance derivative admission exceeded its bounded CAS retry limit.');
	}

	async #maintain(protectedKeys?: ReadonlySet<string>): Promise<boolean> {
		let protectedRemoved = false;
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const state = await this.#inventory();
			const removalKeys = this.#evictionKeys(state.inventory.entries);
			if (removalKeys.size === 0) return !protectedRemoved;
			if (protectedKeys) {
				protectedRemoved ||= [...removalKeys].some((key) => protectedKeys.has(key));
			}
			await this.#retireInventoryEntries(
				state.inventory.entries.filter(({ key }) => removalKeys.has(key)),
			);
		}
		throw new Error('Assistance derivative maintenance exceeded its bounded CAS retry limit.');
	}

	async #retireInventoryEntries(
		entries: readonly AssistanceDerivativeInventoryEntryV1[],
	): Promise<void> {
		const requested = new Map(entries.map((entry) => [entry.key, entry]));
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const state = await this.#inventory();
			const ownedKeys = state.inventory.entries
				.filter((entry) => {
					const expected = requested.get(entry.key);
					return expected !== undefined
						&& sameAssistanceDerivativeInventoryEntry(entry, expected);
				})
				.map(({ key }) => key);
			if (ownedKeys.length === 0) return;
			const owned = new Set(ownedKeys);
			const next = assistanceDerivativeInventory(
				state.inventory.entries.filter(({ key }) => !owned.has(key)),
			);
			if (await this.#values.deleteKeysIfCurrentAndUpdate(
				ownedKeys, ASSISTANCE_DERIVATIVE_INVENTORY_KEY, state.value, next,
			)) return;
		}
		throw new Error('Assistance derivative retirement exceeded its bounded CAS retry limit.');
	}

	#evictionKeys(entries: readonly AssistanceDerivativeInventoryEntryV1[]): ReadonlySet<string> {
		const plan = planDerivativeCacheEviction(entries.map(assistanceDerivativeEvictionRecord), {
			...this.#limits,
			now: this.#timestamp(),
		});
		return new Set(plan.removals.map(({ key }) => String(key)));
	}

	#recordCurrent(record: AssistanceDerivativeRecordV1): boolean {
		return this.#evictionKeys([assistanceDerivativeInventoryEntry(record)]).size === 0;
	}

	async #retireKey(
		key: string,
		expectedValue: unknown | typeof READ_CURRENT = READ_CURRENT,
	): Promise<boolean> {
		const readCurrent = expectedValue === READ_CURRENT;
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const state = await this.#inventory();
			const entry = state.inventory.entries.find((candidate) => candidate.key === key);
			const value = readCurrent ? await this.#values.get(key) : expectedValue;
			if (!entry) {
				if (value === undefined) return false;
				if (await this.#values.deleteIfCurrent(key, value)) return true;
			} else {
				const next = assistanceDerivativeInventoryWithoutKey(state.inventory, key);
				if (value === undefined) {
					if (await this.#values.replaceIfCurrent(
						ASSISTANCE_DERIVATIVE_INVENTORY_KEY, state.value, next,
					)) return false;
				} else if (await this.#values.deleteIfCurrentAndUpdate(
					key, value, ASSISTANCE_DERIVATIVE_INVENTORY_KEY, state.value, next,
				)) return true;
			}
			if (!readCurrent && await this.#values.get(key) === undefined) {
				await this.#removeInventoryKey(key);
				return false;
			}
		}
		if (!readCurrent) return false;
		throw new Error('Assistance derivative retirement exceeded its bounded CAS retry limit.');
	}

	async #removeInventoryKey(key: string): Promise<void> {
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const state = await this.#inventory();
			if (!state.inventory.entries.some((entry) => entry.key === key)) return;
			const next = assistanceDerivativeInventoryWithoutKey(state.inventory, key);
			if (await this.#values.replaceIfCurrent(
				ASSISTANCE_DERIVATIVE_INVENTORY_KEY, state.value, next,
			)) return;
		}
		throw new Error('Assistance derivative inventory repair exceeded its bounded CAS retry limit.');
	}

	async #deleteRows(prefix: string): Promise<number> {
		const state = await this.#inventory();
		const keys = state.inventory.entries.filter(({ key }) => key.startsWith(prefix)).map(({ key }) => key);
		let deleted = 0;
		for (const key of keys) {
			if (await this.#retireKey(key)) deleted += 1;
		}
		return deleted;
	}

	async #inventory(): Promise<InventoryState> {
		for (let attempt = 0; attempt < MAXIMUM_CAS_ATTEMPTS; attempt += 1) {
			const value = await this.#values.get(ASSISTANCE_DERIVATIVE_INVENTORY_KEY);
			if (value !== undefined) {
				const inventory = normalizeAssistanceDerivativeInventoryOrNull(value);
				if (inventory) return Object.freeze({ value, inventory });
				if (!await this.#values.deleteIfCurrent(ASSISTANCE_DERIVATIVE_INVENTORY_KEY, value)) continue;
			}
			const migrated = await this.#bootstrapInventory();
			if (migrated) return migrated;
		}
		throw new Error('Assistance derivative inventory initialization exceeded its bounded CAS retry limit.');
	}

	async #bootstrapInventory(): Promise<InventoryState | null> {
		const rows = await this.#values.listByPrefix(ASSISTANCE_DERIVATIVE_KEY_PREFIX);
		const valid: Readonly<{
			row: Readonly<KeyValuePrefixRecord>;
			entry: AssistanceDerivativeInventoryEntryV1;
		}>[] = [];
		const discard: Readonly<KeyValuePrefixRecord>[] = [];
		for (const row of rows) {
			const record = normalizeAssistanceDerivativeRecordOrNull(row.value);
			if (!record || record.key !== row.key) discard.push(row);
			else valid.push(Object.freeze({ row, entry: assistanceDerivativeInventoryEntry(record) }));
		}
		const removalKeys = this.#evictionKeys(valid.map(({ entry }) => entry));
		const inventory = assistanceDerivativeInventory(
			valid.filter(({ entry }) => !removalKeys.has(entry.key)).map(({ entry }) => entry),
		);
		if (!await this.#values.putIfAbsent(ASSISTANCE_DERIVATIVE_INVENTORY_KEY, inventory)) return null;
		for (const row of discard) await this.#values.deleteIfCurrent(row.key, row.value);
		for (const { row } of valid) {
			if (removalKeys.has(row.key)) await this.#values.deleteIfCurrent(row.key, row.value);
		}
		return Object.freeze({ value: inventory, inventory });
	}

	#timestamp(): number {
		return assistanceDerivativeTimestamp(this.#now());
	}

	#serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
		const result = this.#operations.then(operation, operation);
		this.#operations = result.catch(() => undefined);
		return result;
	}
}

function assertFits(size: number, limits: NormalizedDerivativeCacheLimits): void {
	if (limits.maximumEntries === 0 || size > limits.maximumBytes || limits.maximumAgeMs === 0) {
		throw new RangeError('The assistance derivative cannot fit within its configured limits.');
	}
}
