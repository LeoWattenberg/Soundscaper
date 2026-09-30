/* SPDX-License-Identifier: AGPL-3.0-only */

/** Snapshot a storage value while retaining the legacy JSON fallback. */
export function cloneStorageValue<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
