/* SPDX-License-Identifier: AGPL-3.0-only */

/** Install class-style, non-enumerable methods from focused implementation maps. */
export function installEngineMethodMaps(target: object, methodMaps: readonly object[]): void {
	const installedKeys = new Set<PropertyKey>();
	for (const methodMap of methodMaps) {
		for (const key of Reflect.ownKeys(methodMap)) {
			if (installedKeys.has(key)) {
				throw new TypeError(`Duplicate engine runtime method: ${String(key)}`);
			}
			const descriptor = Object.getOwnPropertyDescriptor(methodMap, key);
			if (!descriptor) continue;
			installedKeys.add(key);
			Object.defineProperty(target, key, { ...descriptor, enumerable: false });
		}
	}
}
