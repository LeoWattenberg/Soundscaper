/* SPDX-License-Identifier: AGPL-3.0-only */

/** Recursively fence every public controller action at the lifetime boundary. */
export function guardEditorControllerActions<Value>(
	value: Value,
	assertActive: () => void,
): Value {
	if (typeof value === 'function') {
		return ((...args: readonly unknown[]) => {
			assertActive();
			return Reflect.apply(value, undefined, args);
		}) as Value;
	}
	if (!value || typeof value !== 'object') return value;
	return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [
		key,
		guardEditorControllerActions(child, assertActive),
	]))) as Value;
}
