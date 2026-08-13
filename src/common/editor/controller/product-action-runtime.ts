/* SPDX-License-Identifier: AGPL-3.0-only */

/** Close the generic composition-root seam without importing a product owner. */
export function productActionRuntime(options: unknown): Readonly<{ readonly productSequenceActions?: unknown }> {
	if (!options || typeof options !== 'object' || Array.isArray(options)) return Object.freeze({});
	const descriptor = Object.getOwnPropertyDescriptor(options, 'productSequenceActions');
	if (!descriptor) return Object.freeze({});
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError('Product sequence actions must be an own enumerable data property.');
	}
	return Object.freeze({ productSequenceActions: descriptor.value });
}
