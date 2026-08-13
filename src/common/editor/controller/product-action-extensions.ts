/* SPDX-License-Identifier: AGPL-3.0-only */

export function snapshotProductActionExtensions<Action extends (...args: never[]) => unknown>(
	value: unknown,
	reservedNames: readonly string[],
): Readonly<Record<string, Action>> {
	if (value === undefined) return Object.freeze({});
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Product action extensions must be an object.');
	}
	const reserved = new Set(reservedNames);
	const result: Record<string, Action> = {};
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || reserved.has(key)) {
			throw new TypeError('Product action extensions contain a reserved action name.');
		}
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
			|| typeof descriptor.value !== 'function') {
			throw new TypeError('Product action extensions must contain own enumerable functions.');
		}
		result[key] = descriptor.value as Action;
	}
	return Object.freeze(result);
}
