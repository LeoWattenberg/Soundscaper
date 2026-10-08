/* SPDX-License-Identifier: AGPL-3.0-only */

import { compareInstrumentedKeys, instrumentedKeyPath, matchesInstrumentedQuery } from './instrumented-indexeddb-keys.ts';

export interface InstrumentedIndexDefinition {
	readonly keyPath: string | readonly string[];
	readonly unique: boolean;
	readonly multiEntry: boolean;
}
type Row = Record<string, unknown>;

/** Native browser witnesses remain authoritative; this models the index options used by storage tests. */
export function instrumentedIndexEntries(records: ReadonlyMap<unknown, Row>, definition: InstrumentedIndexDefinition,
	query: unknown): { key: unknown; primaryKey: unknown; value: Row }[] {
	return [...records].flatMap(([primaryKey, value]) => indexKeys(value, definition).map(key => ({ key, primaryKey, value })))
		.filter(({ key }) => matchesInstrumentedQuery(key, query))
		.sort((left, right) => compareInstrumentedKeys(left.key, right.key) || compareInstrumentedKeys(left.primaryKey, right.primaryKey));
}

export function checkInstrumentedUniqueIndexes(indexes: ReadonlyMap<string, InstrumentedIndexDefinition>,
	records: ReadonlyMap<unknown, Row>, primaryKey: unknown, value: Row): void {
	for (const [name, definition] of indexes) {
		if (!definition.unique) continue;
		const keys = indexKeys(value, definition);
		for (const [existingKey, existing] of records) {
			if (compareInstrumentedKeys(primaryKey, existingKey) === 0) continue;
			const previous = indexKeys(existing, definition);
			if (keys.some(key => previous.some(other => compareInstrumentedKeys(key, other) === 0))) {
				throw new DOMException(`Index ${name} already contains this key.`, 'ConstraintError');
			}
		}
	}
}

function indexKeys(value: Row, definition: InstrumentedIndexDefinition): unknown[] {
	const projected = instrumentedKeyPath(value, definition.keyPath);
	const candidates: readonly unknown[] = definition.multiEntry && Array.isArray(projected) ? projected : [projected];
	const keys: unknown[] = [];
	for (const key of candidates) {
		if (validKey(key) && !keys.some(other => compareInstrumentedKeys(key, other) === 0)) keys.push(key);
	}
	return keys;
}
function validKey(value: unknown): boolean {
	if (typeof value === 'string' || typeof value === 'number' && !Number.isNaN(value)) return true;
	if (value instanceof Date) return !Number.isNaN(value.getTime());
	if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
	if (!Array.isArray(value)) return false;
	for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index) || !validKey(value[index])) return false;
	return true;
}
