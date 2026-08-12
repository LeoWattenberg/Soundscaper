/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	DEFAULT_DERIVATIVE_CACHE_LIMITS,
	normalizeDerivativeCacheLimits,
	planDerivativeCacheEviction,
	type DerivativeCacheLimits,
	type DerivativeCacheRecord,
	type NormalizedDerivativeCacheLimits,
} from './derivative-cache-policy.ts';
import { KeyValueRepository, type KeyValuePrefixRecord } from './key-value-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import {
	TRANSIENT_ANALYSIS_CACHE_KEY_PREFIX,
	isTransientAnalysisCacheKey,
	normalizeTransientAnalysisCacheRecord,
	type TransientAnalysisCacheRecord,
} from './transient-analysis-cache.ts';

export const TRANSIENT_ANALYSIS_CACHE_ENTRY_KEY_PREFIX = 'transient-analysis-cache-entry-v1:';
/** Keep one physical prefix-inventory slot free for publication and repair. */
export const TRANSIENT_ANALYSIS_CACHE_MAXIMUM_ENTRIES = 4_095;
export const DEFAULT_TRANSIENT_ANALYSIS_CACHE_LIMITS: NormalizedDerivativeCacheLimits = Object.freeze({
	...DEFAULT_DERIVATIVE_CACHE_LIMITS,
	maximumEntries: TRANSIENT_ANALYSIS_CACHE_MAXIMUM_ENTRIES,
});

const ENTRY_VERSION = 1;
const ENTRY_KEYS = new Set([
	'version', 'key', 'payloadKey', 'size', 'payloadSha256', 'committedAt',
]);
const MAXIMUM_TIMESTAMP = 8_640_000_000_000_000;
const MAXIMUM_MAINTENANCE_ATTEMPTS = 8;

export interface TransientAnalysisCacheRepositoryOptions {
	readonly limits?: Readonly<Pick<
		DerivativeCacheLimits,
		'maximumBytes' | 'maximumEntries' | 'maximumAgeMs'
	>>;
	readonly now?: () => number;
}

export interface TransientAnalysisCacheKeyValuePort {
	get(key: string): PromiseLike<unknown> | unknown;
	put(key: string, value: unknown): PromiseLike<unknown> | unknown;
	delete(key: string): PromiseLike<unknown> | unknown;
	deleteByPrefix(prefix: string): PromiseLike<number> | number;
	replaceIfCurrent(
		key: string,
		expected: unknown,
		replacement: unknown,
	): PromiseLike<boolean> | boolean;
	deleteIfCurrent(key: string, expected: unknown): PromiseLike<boolean> | boolean;
	listByPrefix(prefix: string): PromiseLike<readonly Readonly<KeyValuePrefixRecord>[]>
		| readonly Readonly<KeyValuePrefixRecord>[];
}

interface TransientAnalysisCacheEntry extends DerivativeCacheRecord {
	readonly version: typeof ENTRY_VERSION;
	readonly key: string;
	readonly payloadKey: string;
	readonly size: number;
	readonly payloadSha256: string;
	readonly committedAt: string;
}

interface ValidatedPair {
	readonly payload: Readonly<TransientAnalysisCacheRecord>;
	readonly payloadValue: unknown;
	readonly entry: Readonly<TransientAnalysisCacheEntry>;
	readonly entryValue: unknown;
}

interface CacheInventory {
	readonly pairs: readonly Readonly<ValidatedPair>[];
	readonly discard: readonly Readonly<KeyValuePrefixRecord>[];
}

/**
 * Own the disposable transient namespace over generic analysis storage. Useful
 * byte accounting is exactly the validated transient payload byte length; the
 * small scalar LRU companion is deliberately excluded from that budget.
 */
export class TransientAnalysisCacheRepository {
	readonly #values: TransientAnalysisCacheKeyValuePort;
	readonly #limits: NormalizedDerivativeCacheLimits;
	readonly #now: () => number;
	#maintenance: Promise<unknown> = Promise.resolve();

	constructor(
		portOrValues: StorageRepositoryPort | TransientAnalysisCacheKeyValuePort,
		options: Readonly<TransientAnalysisCacheRepositoryOptions> = {},
	) {
		this.#values = isKeyValuePort(portOrValues)
			? portOrValues
			: keyValueRepository(portOrValues);
		this.#limits = normalizeDerivativeCacheLimits(
			options.limits ?? DEFAULT_TRANSIENT_ANALYSIS_CACHE_LIMITS,
		);
		if (this.#limits.maximumEntries > TRANSIENT_ANALYSIS_CACHE_MAXIMUM_ENTRIES) {
			throw new RangeError(
				`Transient analysis cache maximumEntries cannot exceed ${String(TRANSIENT_ANALYSIS_CACHE_MAXIMUM_ENTRIES)}.`,
			);
		}
		this.#now = options.now ?? Date.now;
	}

	load(keyValue: string): Promise<Readonly<TransientAnalysisCacheRecord> | null> {
		const key = canonicalCacheKey(keyValue);
		return this.#serialize(() => this.#load(key));
	}

	save(
		keyValue: string,
		value: unknown,
	): Promise<Readonly<TransientAnalysisCacheRecord>> {
		const key = canonicalCacheKey(keyValue);
		return this.#serialize(() => this.#save(key, value));
	}

	delete(keyValue: string): Promise<void> {
		const key = canonicalCacheKey(keyValue);
		return this.#serialize(() => this.#deletePair(key));
	}

	/** Delete only owned transient rows. Callers may safely retry after failure. */
	purge(): Promise<void> {
		return this.#serialize(async () => {
			await this.#values.deleteByPrefix(TRANSIENT_ANALYSIS_CACHE_KEY_PREFIX);
			await this.#values.deleteByPrefix(TRANSIENT_ANALYSIS_CACHE_ENTRY_KEY_PREFIX);
		});
	}

	async #load(key: string): Promise<Readonly<TransientAnalysisCacheRecord> | null> {
		const payloadValue = await this.#values.get(key);
		const entryValue = await this.#values.get(transientAnalysisCacheEntryKey(key));
		const pair = validatePair(key, payloadValue, entryValue);
		if (!pair) {
			await this.#discardSnapshot(key, payloadValue, entryValue);
			await this.#evictAndRepair();
			return null;
		}
		const now = this.#timestamp();
		const expiryPlan = planDerivativeCacheEviction([pair.entry], { ...this.#limits, now });
		if (expiryPlan.removals.some(({ key: removalKey }) => removalKey === pair.entry.key)) {
			await this.#compareAndDeletePair(pair);
			await this.#evictAndRepair();
			return null;
		}
		const touched = cacheEntry(pair.payload, now);
		if (!await this.#values.replaceIfCurrent(pair.entry.key, pair.entryValue, touched)) {
			await this.#evictAndRepair();
			return null;
		}
		await this.#evictAndRepair();
		return pair.payload;
	}

	async #save(
		key: string,
		value: unknown,
	): Promise<Readonly<TransientAnalysisCacheRecord>> {
		const payload = normalizeTransientAnalysisCacheRecord(value);
		if (payload.key !== key) throw new Error('The transient analysis cache key does not match its payload.');
		assertFits(payload.payloadByteLength, this.#limits);
		const entry = cacheEntry(payload, this.#timestamp());
		const publicationPair = validatePair(payload.key, payload, entry);
		if (!publicationPair) throw new Error('The transient analysis cache publication is invalid.');
		await this.#values.put(payload.key, payload);
		try {
			await this.#values.put(entry.key, entry);
		} catch (error) {
			await Promise.resolve(this.#values.deleteIfCurrent(payload.key, payload)).catch(() => undefined);
			await this.#evictAndRepair().catch(() => undefined);
			throw error;
		}
		try {
			await this.#settlePublication(payload.key);
		} catch (error) {
			await this.#compareAndDeletePair(publicationPair).catch(() => undefined);
			await this.#evictAndRepair().catch(() => undefined);
			throw error;
		}
		return payload;
	}

	async #evictAndRepair(): Promise<void> {
		for (let attempt = 0; attempt < MAXIMUM_MAINTENANCE_ATTEMPTS; attempt += 1) {
			const inventory = await this.#inventory();
			const plan = planDerivativeCacheEviction(
				inventory.pairs.map(({ entry }) => entry),
				{ ...this.#limits, now: this.#timestamp() },
			);
			if (!inventory.discard.length && !plan.removals.length) return;
			await this.#applyMaintenance(inventory, plan.removals);
		}
		throw new Error('Transient analysis cache maintenance exceeded its bounded retry limit.');
	}

	async #settlePublication(payloadKey: string): Promise<void> {
		for (let attempt = 0; attempt < MAXIMUM_MAINTENANCE_ATTEMPTS; attempt += 1) {
			const inventory = await this.#inventory();
			const incoming = inventory.pairs.find((pair) => pair.payload.key === payloadKey);
			if (!incoming) {
				throw new Error('The transient analysis cache publication failed its paired integrity check.');
			}
			const plan = planDerivativeCacheEviction(
				inventory.pairs.map(({ entry }) => entry),
				{ ...this.#limits, now: this.#timestamp() },
			);
			if (plan.removals.some(({ key }) => key === incoming.entry.key)) {
				throw new RangeError('The transient analysis cache entry cannot fit within its configured limits.');
			}
			if (!inventory.discard.length && !plan.removals.length) return;
			await this.#applyMaintenance(inventory, plan.removals);
		}
		throw new Error('Transient analysis cache publication exceeded its bounded retry limit.');
	}

	async #applyMaintenance(
		inventory: Readonly<CacheInventory>,
		removals: readonly Readonly<DerivativeCacheRecord>[],
	): Promise<void> {
		const removalKeys = new Set(removals.map(({ key }) => String(key)));
		for (const row of inventory.discard) {
			await this.#values.deleteIfCurrent(row.key, row.value);
		}
		for (const pair of inventory.pairs) {
			if (!removalKeys.has(pair.entry.key)) continue;
			await this.#compareAndDeletePair(pair);
		}
	}

	async #inventory(): Promise<Readonly<CacheInventory>> {
		const [payloadRows, entryRows] = await Promise.all([
			this.#values.listByPrefix(TRANSIENT_ANALYSIS_CACHE_KEY_PREFIX),
			this.#values.listByPrefix(TRANSIENT_ANALYSIS_CACHE_ENTRY_KEY_PREFIX),
		]);
		const entries = new Map(entryRows.map((row) => [row.key, row]));
		const pairs: Readonly<ValidatedPair>[] = [];
		const discard: Readonly<KeyValuePrefixRecord>[] = [];
		for (const payloadRow of payloadRows) {
			const entryKey = transientAnalysisCacheEntryKeyIfCanonical(payloadRow.key);
			if (!entryKey) {
				discard.push(payloadRow);
				continue;
			}
			const entryRow = entries.get(entryKey);
			const pair = validatePair(payloadRow.key, payloadRow.value, entryRow?.value);
			if (!pair || !entryRow) {
				discard.push(payloadRow);
				if (entryRow) {
					discard.push(entryRow);
					entries.delete(entryKey);
				}
				continue;
			}
			pairs.push(pair);
			entries.delete(entryKey);
		}
		discard.push(...entries.values());
		return Object.freeze({ pairs: Object.freeze(pairs), discard: Object.freeze(discard) });
	}

	async #compareAndDeletePair(pair: Readonly<ValidatedPair>): Promise<void> {
		if (!await this.#values.deleteIfCurrent(pair.payload.key, pair.payloadValue)) return;
		await this.#values.deleteIfCurrent(pair.entry.key, pair.entryValue);
	}

	async #deletePair(key: string): Promise<void> {
		await this.#values.delete(key);
		await this.#values.delete(transientAnalysisCacheEntryKey(key));
	}

	async #discardSnapshot(key: string, payloadValue: unknown, entryValue: unknown): Promise<void> {
		if (payloadValue !== undefined) await this.#values.deleteIfCurrent(key, payloadValue);
		if (entryValue !== undefined) {
			await this.#values.deleteIfCurrent(transientAnalysisCacheEntryKey(key), entryValue);
		}
	}

	#timestamp(): number {
		const value = Number(this.#now());
		if (!Number.isSafeInteger(value) || value < 0 || value > MAXIMUM_TIMESTAMP) {
			throw new RangeError('The transient analysis cache timestamp is outside the supported Date range.');
		}
		return value;
	}

	#serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
		const pending = this.#maintenance.then(operation, operation);
		this.#maintenance = pending.catch(() => undefined);
		return pending;
	}
}

export function transientAnalysisCacheEntryKey(payloadKeyValue: string): string {
	const payloadKey = canonicalCacheKey(payloadKeyValue);
	return `${TRANSIENT_ANALYSIS_CACHE_ENTRY_KEY_PREFIX}${payloadKey.slice(TRANSIENT_ANALYSIS_CACHE_KEY_PREFIX.length)}`;
}

export function isTransientAnalysisCacheEntryNamespaceKey(value: unknown): value is string {
	return typeof value === 'string' && value.startsWith(TRANSIENT_ANALYSIS_CACHE_ENTRY_KEY_PREFIX);
}

function validatePair(
	payloadKey: string,
	payloadValue: unknown,
	entryValue: unknown,
): Readonly<ValidatedPair> | null {
	try {
		const payload = normalizeTransientAnalysisCacheRecord(payloadValue);
		const entry = normalizeEntry(entryValue);
		if (payload.key !== payloadKey
			|| entry.payloadKey !== payload.key
			|| entry.key !== transientAnalysisCacheEntryKey(payload.key)
			|| entry.size !== payload.payloadByteLength
			|| entry.payloadSha256 !== payload.payloadSha256) return null;
		return Object.freeze({ payload, payloadValue, entry, entryValue });
	} catch {
		return null;
	}
}

function cacheEntry(
	payload: Readonly<TransientAnalysisCacheRecord>,
	now: number,
): Readonly<TransientAnalysisCacheEntry> {
	return Object.freeze({
		version: ENTRY_VERSION,
		key: transientAnalysisCacheEntryKey(payload.key),
		payloadKey: payload.key,
		size: payload.payloadByteLength,
		payloadSha256: payload.payloadSha256,
		committedAt: new Date(now).toISOString(),
	});
}

function normalizeEntry(value: unknown): Readonly<TransientAnalysisCacheEntry> {
	const candidate = closedRecord(value, ENTRY_KEYS, 'transient analysis cache LRU entry');
	if (candidate.version !== ENTRY_VERSION) throw new RangeError('The transient analysis cache LRU version is unsupported.');
	const payloadKey = canonicalCacheKey(candidate.payloadKey);
	const key = transientAnalysisCacheEntryKey(payloadKey);
	if (candidate.key !== key) throw new Error('The transient analysis cache LRU key does not match its payload.');
	const size = nonNegativeSafeInteger(candidate.size, 'transient analysis cache useful byte length');
	const payloadSha256 = lowercaseSha256(candidate.payloadSha256);
	const committedAt = canonicalTimestamp(candidate.committedAt);
	return Object.freeze({ version: ENTRY_VERSION, key, payloadKey, size, payloadSha256, committedAt });
}

function closedRecord(
	value: unknown,
	keys: ReadonlySet<string>,
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object.`);
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} must be a plain object.`);
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.length !== keys.size || ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))) {
		throw new TypeError(`${label} has unsupported or missing fields.`);
	}
	const result: Record<string, unknown> = {};
	for (const key of ownKeys) {
		if (typeof key !== 'string') throw new TypeError(`${label} has a symbol field.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${key} must be an enumerable data property.`);
		}
		result[key] = descriptor.value;
	}
	return result;
}

function canonicalCacheKey(value: unknown): string {
	if (!isTransientAnalysisCacheKey(value)) throw new TypeError('A canonical transient analysis cache key is required.');
	return value;
}

function transientAnalysisCacheEntryKeyIfCanonical(payloadKey: string): string | null {
	return isTransientAnalysisCacheKey(payloadKey) ? transientAnalysisCacheEntryKey(payloadKey) : null;
}

function canonicalTimestamp(value: unknown): string {
	if (typeof value !== 'string') throw new TypeError('A transient analysis cache LRU timestamp is required.');
	const timestamp = Date.parse(value);
	if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > MAXIMUM_TIMESTAMP
		|| new Date(timestamp).toISOString() !== value) {
		throw new RangeError('The transient analysis cache LRU timestamp is not canonical.');
	}
	return value;
}

function lowercaseSha256(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError('A lowercase SHA-256 digest is required for transient cache metadata.');
	}
	return value;
}

function nonNegativeSafeInteger(value: unknown, field: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${field} must be a non-negative safe integer.`);
	}
	return Object.is(value, -0) ? 0 : Number(value);
}

function assertFits(size: number, limits: NormalizedDerivativeCacheLimits): void {
	if (limits.maximumEntries === 0 || size > limits.maximumBytes || limits.maximumAgeMs === 0) {
		throw new RangeError('The transient analysis cache entry cannot fit within its configured limits.');
	}
}

function isKeyValuePort(
	value: StorageRepositoryPort | TransientAnalysisCacheKeyValuePort,
): value is TransientAnalysisCacheKeyValuePort {
	return typeof (value as Partial<TransientAnalysisCacheKeyValuePort>).listByPrefix === 'function';
}

function keyValueRepository(port: StorageRepositoryPort): TransientAnalysisCacheKeyValuePort {
	return new KeyValueRepository(port, 'analysis');
}
