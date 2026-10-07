/* SPDX-License-Identifier: AGPL-3.0-only */

/** Freeze nested tooling records while retaining the original value and identity. */
export function deepFreeze<Value>(value: Value): Value {
	if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
	for (const child of Object.values(value)) deepFreeze(child);
	return Object.freeze(value);
}
