/* SPDX-License-Identifier: AGPL-3.0-only */

import { DERIVATIVE_CACHE_ENTRY_STORE_NAME, DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME, projectDerivativeCacheInventoryRecord, VIDEO_DERIVATIVE_STORE_NAME } from './derivative-cache-entry.ts';
import { request } from './indexeddb-backend.ts';
import type { StorageRecord } from './media-records.ts';
import { readBinaryDerivativeCacheRecordV1 } from './binary-derivative-cache-records.ts';

export async function deletePairedDerivativeRecords(
	stores: Readonly<Record<string, IDBObjectStore>>,
	sourceId: string,
	matches: (record: StorageRecord) => boolean = () => true,
): Promise<StorageRecord[]> {
	const videoDerivatives = cacheStore(stores, VIDEO_DERIVATIVE_STORE_NAME);
	const cacheEntries = cacheStore(stores, DERIVATIVE_CACHE_ENTRY_STORE_NAME);
	const candidates = scalarDerivativeRecords(await request(
		cacheEntries.index(DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME).getAll(sourceId),
	)).filter((record) => record.sourceId === sourceId && matches(record));
	const validated: StorageRecord[] = [];
	for (const expected of candidates) {
		const key = expected.key as string;
		const payload = asStorageRecord(await request(videoDerivatives.get(key)));
		if (!sameDerivativeCacheRecord(payload, expected)) {
			throw new Error(`Derivative cache payload ${key} does not match its deletion metadata.`);
		}
		validated.push(projectDerivativeCacheInventoryRecord(payload, key));
	}
	for (const record of validated) {
		const key = record.key as string;
		videoDerivatives.delete(key);
		cacheEntries.delete(key);
	}
	return validated;
}

export function asStorageRecord(value: unknown): StorageRecord | null {
	return value && typeof value === 'object' ? value as StorageRecord : null;
}

export function isStorageRecord(value: StorageRecord | null): value is StorageRecord {
	return value !== null;
}

export function scalarDerivativeRecords(values: readonly unknown[]): StorageRecord[] {
	return values.map(asStorageRecord).filter(isStorageRecord).map((record) => {
		if (typeof record.key !== 'string') throw new TypeError('A derivative cache record key is required.');
		return record.derivativeBindingVersion === undefined && record.binaryDerivativeManifest !== undefined
			? readBinaryDerivativeCacheRecordV1(record, record.key)
			: projectDerivativeCacheInventoryRecord(record, record.key);
	});
}

export function sameDerivativeCacheRecord(
	current: StorageRecord | null,
	expected: Readonly<Record<string, unknown>>,
): current is StorageRecord {
	if (!current || current.key !== expected.key) return false;
	if (current.derivativeBindingVersion === undefined && expected.derivativeBindingVersion === undefined
		&& (current.binaryDerivativeManifest !== undefined || expected.binaryDerivativeManifest !== undefined)) {
		return current.binaryDerivativeManifest === expected.binaryDerivativeManifest
			&& current.type === expected.type
			&& current.cacheToken === expected.cacheToken
			&& current.sourceId === expected.sourceId && current.originalSha256 === expected.originalSha256
			&& current.originalByteLength === expected.originalByteLength
			&& current.originalMediaContentToken === expected.originalMediaContentToken
			&& current.recipeId === expected.recipeId && current.recipeVersion === expected.recipeVersion
			&& current.outputSha256 === expected.outputSha256 && current.mimeType === expected.mimeType
			&& current.storage === expected.storage && current.path === expected.path
			&& current.size === expected.size && current.committedAt === expected.committedAt;
	}
	if (typeof current.cacheToken === 'string' || typeof expected.cacheToken === 'string') {
		if (typeof current.cacheToken !== 'string'
			|| current.cacheToken !== expected.cacheToken) return false;
	}
	const baseMatches = current.sourceId === expected.sourceId
		&& current.timestamp === expected.timestamp
		&& current.type === expected.type
		&& current.storage === expected.storage
		&& (current.path || null) === (expected.path || null)
		&& current.size === expected.size
		&& current.committedAt === expected.committedAt;
	if (!baseMatches) return false;
	const bound = current.derivativeBindingVersion !== undefined
		|| expected.derivativeBindingVersion !== undefined;
	return !bound || current.derivativeBindingVersion === expected.derivativeBindingVersion
		&& current.originalSha256 === expected.originalSha256
		&& current.originalMediaContentToken === expected.originalMediaContentToken
		&& current.recipeId === expected.recipeId
		&& current.recipeVersion === expected.recipeVersion
		&& current.outputSha256 === expected.outputSha256;
}
/** Transaction store names were declared by the caller before opening the transaction. */
export function cacheStore(stores: Readonly<Record<string, IDBObjectStore>>, name: string): IDBObjectStore {
	const store = stores[name];
	if (!store) throw new Error(`The binary cache transaction is missing store ${name}.`);
	return store;
}
