/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StorageRecord } from './media-records.ts';

export const VIDEO_DERIVATIVE_STORE_NAME = 'videoDerivatives';
export const DERIVATIVE_CACHE_ENTRY_STORE_NAME = 'videoDerivativeCacheEntries';
export const DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME = 'sourceId';

export interface DerivativeCacheInventoryRecord extends StorageRecord {
	readonly key: string;
}

/**
 * Retain only the scalar fields required to account, compare, and dispose of a
 * derivative. The cursor primary key is authoritative so malformed payloads
 * cannot redirect later compare-and-delete operations.
 */
export function projectDerivativeCacheInventoryRecord(
	value: unknown,
	primaryKey: IDBValidKey,
): DerivativeCacheInventoryRecord {
	if (typeof primaryKey !== 'string' || primaryKey.length === 0) {
		throw new TypeError('A derivative cache cursor primary key is required.');
	}
	if (!value || typeof value !== 'object') {
		throw new TypeError(`Derivative cache record ${primaryKey} is invalid.`);
	}
	const record = value as StorageRecord;
	if (record.key !== primaryKey) {
		throw new Error(`Derivative cache record ${primaryKey} does not match its cursor primary key.`);
	}
	const derivativeBindingVersion = optionalFiniteNumber(record.derivativeBindingVersion);
	return Object.freeze({
		key: primaryKey,
		sourceId: optionalString(record.sourceId),
		timestamp: optionalFiniteNumber(record.timestamp),
		type: optionalString(record.type),
		storage: optionalString(record.storage),
		path: optionalNullableString(record.path),
		size: optionalFiniteNumber(record.size),
		committedAt: optionalString(record.committedAt),
		cacheToken: optionalString(record.cacheToken),
		...(derivativeBindingVersion === undefined ? {} : {
			derivativeBindingVersion,
			originalSha256: optionalString(record.originalSha256),
			originalMediaContentToken: optionalString(record.originalMediaContentToken),
			recipeId: optionalString(record.recipeId),
			recipeVersion: optionalFiniteNumber(record.recipeVersion),
			outputSha256: optionalString(record.outputSha256),
		}),
	});
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function optionalNullableString(value: unknown): string | null | undefined {
	return value === null ? null : optionalString(value);
}

function optionalFiniteNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
