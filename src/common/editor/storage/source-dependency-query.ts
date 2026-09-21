/* SPDX-License-Identifier: AGPL-3.0-only */

import type { StorageRecord } from './media-records.ts';

/** Return the first derived source retained by one base in memory iteration order. */
export function findMemoryDependentSourceId(
	sources: ReadonlyMap<string, unknown>,
	baseSourceId: string,
): string | null {
	for (const [primaryKey, value] of sources) {
		const dependentSourceId = dependentId(value, primaryKey, baseSourceId);
		if (dependentSourceId !== null) return dependentSourceId;
	}
	return null;
}

/** Return the first derived source retained by one base in object-store cursor order. */
export function findStoredDependentSourceId(
	sources: IDBObjectStore,
	baseSourceId: string,
): Promise<string | null> {
	return new Promise((resolve, reject) => {
		const cursorRequest = sources.openCursor();
		cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Could not enumerate source metadata.'));
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) { resolve(null); return; }
			const dependentSourceId = dependentId(cursor.value, cursor.primaryKey, baseSourceId);
			if (dependentSourceId !== null) {
				resolve(dependentSourceId);
				return;
			}
			cursor.continue();
		};
	});
}

function dependentId(value: unknown, primaryKey: IDBValidKey, baseSourceId: string): string | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as StorageRecord;
	return candidate.baseSourceId === baseSourceId
		? String(candidate.id ?? primaryKey)
		: null;
}
