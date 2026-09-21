/* SPDX-License-Identifier: AGPL-3.0-only */

/** Compare a canonical export snapshot without invoking getters or losing object aliasing. */
export function assertMatchingExportDataGraph(
	left: unknown,
	right: unknown,
	name: string,
	canonicalProject: 'canonical project' | 'canonical retime project',
): void {
	const pending: Array<readonly [unknown, unknown]> = [[left, right]];
	const paired = new WeakMap<object, object>();
	let nodeCount = 0;
	while (pending.length > 0) {
		const [leftValue, rightValue] = pending.pop()!;
		if (Object.is(leftValue, rightValue)) continue;
		if (!leftValue || typeof leftValue !== 'object'
			|| !rightValue || typeof rightValue !== 'object') {
			throw new Error(`${name} diverges from its exact ${canonicalProject}.`);
		}
		const leftObject = leftValue as object;
		const rightObject = rightValue as object;
		const prior = paired.get(leftObject);
		if (prior) {
			if (prior !== rightObject) throw new Error(`${name} has divergent object aliases.`);
			continue;
		}
		paired.set(leftObject, rightObject);
		nodeCount += 1;
		if (nodeCount > 2_000_000) throw new RangeError(`${name} exceeds its comparison budget.`);
		if (Array.isArray(leftObject) !== Array.isArray(rightObject)) {
			throw new Error(`${name} diverges from its exact ${canonicalProject}.`);
		}
		const leftKeys = Reflect.ownKeys(leftObject);
		const rightKeys = Reflect.ownKeys(rightObject);
		if (leftKeys.length !== rightKeys.length
			|| leftKeys.some((key, index) => key !== rightKeys[index])) {
			throw new Error(`${name} diverges from its exact ${canonicalProject}.`);
		}
		for (const key of leftKeys) {
			const leftDescriptor = Object.getOwnPropertyDescriptor(leftObject, key);
			const rightDescriptor = Object.getOwnPropertyDescriptor(rightObject, key);
			if (!leftDescriptor || !rightDescriptor
				|| !Object.hasOwn(leftDescriptor, 'value')
				|| !Object.hasOwn(rightDescriptor, 'value')
				|| leftDescriptor.enumerable !== rightDescriptor.enumerable) {
				throw new TypeError(`${name} must contain matching data properties.`);
			}
			pending.push([leftDescriptor.value, rightDescriptor.value]);
		}
	}
}
