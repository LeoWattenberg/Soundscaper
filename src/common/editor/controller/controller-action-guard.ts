/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorActionRuntime } from './action-facade.ts';

/** Recursively fence every public controller action at the lifetime boundary. */
export function guardEditorControllerActions(
	value: EditorActionRuntime[string],
	assertActive: () => void,
): EditorActionRuntime[string] {
	if (typeof value === 'function') {
		return ((...args: readonly unknown[]) => {
			assertActive();
			return Reflect.apply(value, undefined, args);
		});
	}
	if (!value || typeof value !== 'object') return value;
	return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [
		key,
		guardEditorControllerActions(child, assertActive),
	])));
}
