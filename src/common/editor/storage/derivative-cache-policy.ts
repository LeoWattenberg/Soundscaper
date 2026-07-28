/* SPDX-License-Identifier: AGPL-3.0-only */

export interface DerivativeCacheRecord {
	readonly key?: unknown;
	readonly size?: unknown;
	readonly committedAt?: unknown;
	readonly [field: string]: unknown;
}

export interface DerivativeCacheLimits {
	readonly maximumBytes: number;
	readonly maximumEntries: number;
	readonly maximumAgeMs?: number;
	readonly now?: number;
}

export interface DerivativeCacheTotals {
	readonly bytes: number;
	readonly entries: number;
}

export interface DerivativeCacheEvictionPlan {
	readonly limits: Readonly<Required<Pick<DerivativeCacheLimits, 'maximumBytes' | 'maximumEntries'>>
		& Pick<DerivativeCacheLimits, 'maximumAgeMs' | 'now'>>;
	readonly before: Readonly<DerivativeCacheTotals>;
	readonly after: Readonly<DerivativeCacheTotals>;
	readonly removedBytes: number;
	readonly removals: readonly Readonly<DerivativeCacheRecord>[];
}

export interface DerivativeCacheCleanupReport {
	readonly limits: DerivativeCacheEvictionPlan['limits'];
	readonly before: Readonly<DerivativeCacheTotals>;
	readonly after: Readonly<DerivativeCacheTotals>;
	readonly removedBytes: number;
	readonly removedEntries: number;
	readonly skippedEntries: number;
	readonly satisfied: boolean;
}

interface AccountedRecord {
	readonly key: string;
	readonly size: number;
	readonly committedAt: number;
	readonly record: Readonly<DerivativeCacheRecord>;
}

/**
 * Plan deletion of reproducible video derivatives only. The planner is pure so
 * storage backends can compare each candidate with the current record before
 * publication, preventing a stale cleanup snapshot from deleting a replacement.
 */
export function planDerivativeCacheEviction(
	records: readonly Readonly<DerivativeCacheRecord>[],
	limits: Readonly<DerivativeCacheLimits>,
): Readonly<DerivativeCacheEvictionPlan> {
	const maximumBytes = nonNegativeSafeInteger(limits.maximumBytes, 'maximumBytes');
	const maximumEntries = nonNegativeSafeInteger(limits.maximumEntries, 'maximumEntries');
	const maximumAgeMs = limits.maximumAgeMs === undefined
		? undefined
		: nonNegativeSafeInteger(limits.maximumAgeMs, 'maximumAgeMs');
	const now = maximumAgeMs === undefined
		? undefined
		: nonNegativeSafeInteger(limits.now ?? Date.now(), 'now');
	const accounted = account(records);
	let remainingBytes = accounted.reduce((total, record) => safeAdd(total, record.size), 0);
	let remainingEntries = accounted.length;
	const before = totals(remainingBytes, remainingEntries);
	const ordered = [...accounted].sort(compareOldestFirst);
	const removalKeys = new Set<string>();
	const removals: Readonly<DerivativeCacheRecord>[] = [];
	let removedBytes = 0;

	const remove = (candidate: AccountedRecord): void => {
		if (removalKeys.has(candidate.key)) return;
		removalKeys.add(candidate.key);
		removals.push(candidate.record);
		remainingBytes -= candidate.size;
		remainingEntries -= 1;
		removedBytes += candidate.size;
	};
	if (maximumAgeMs !== undefined && now !== undefined) {
		const oldestAllowed = now - maximumAgeMs;
		for (const candidate of ordered) {
			if (!Number.isFinite(candidate.committedAt) || candidate.committedAt <= oldestAllowed) remove(candidate);
		}
	}
	for (const candidate of ordered) {
		if (remainingBytes <= maximumBytes && remainingEntries <= maximumEntries) break;
		remove(candidate);
	}

	return Object.freeze({
		limits: Object.freeze({ maximumBytes, maximumEntries, maximumAgeMs, now }),
		before,
		after: totals(remainingBytes, remainingEntries),
		removedBytes,
		removals: Object.freeze(removals),
	});
}

function account(records: readonly Readonly<DerivativeCacheRecord>[]): AccountedRecord[] {
	const keys = new Set<string>();
	return records.map((record) => {
		const key = typeof record.key === 'string' ? record.key : '';
		if (!key) throw new TypeError('A derivative cache record key is required.');
		if (keys.has(key)) throw new Error(`Duplicate derivative cache record key: ${key}`);
		keys.add(key);
		return {
			key,
			size: nonNegativeSafeInteger(record.size, `Derivative cache record ${key} size`),
			committedAt: typeof record.committedAt === 'string' ? Date.parse(record.committedAt) : Number.NaN,
			record,
		};
	});
}

function compareOldestFirst(left: AccountedRecord, right: AccountedRecord): number {
	const leftTime = Number.isFinite(left.committedAt) ? left.committedAt : Number.NEGATIVE_INFINITY;
	const rightTime = Number.isFinite(right.committedAt) ? right.committedAt : Number.NEGATIVE_INFINITY;
	return leftTime - rightTime || left.key.localeCompare(right.key);
}

function totals(bytes: number, entries: number): Readonly<DerivativeCacheTotals> {
	return Object.freeze({ bytes, entries });
}

function safeAdd(left: number, right: number): number {
	if (right > Number.MAX_SAFE_INTEGER - left) {
		throw new RangeError('Derivative cache byte total exceeds the supported safe integer range.');
	}
	return left + right;
}

function nonNegativeSafeInteger(value: unknown, field: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new RangeError(`${field} must be a non-negative safe integer.`);
	}
	return number;
}
