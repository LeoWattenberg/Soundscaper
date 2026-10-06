/* SPDX-License-Identifier: AGPL-3.0-only */

import { inheritProductProjectBinActionGroup } from './product-project-bin-actions.ts';

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
	const guarded = Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [
		key,
		guardEditorControllerActions(child, assertActive),
	])));
	inheritProductProjectBinActionGroup(value, guarded);
	return guarded as Value;
}
