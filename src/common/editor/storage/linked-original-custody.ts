/* SPDX-License-Identifier: AGPL-3.0-only */

export interface LinkedOriginalBindingIdentity {
	readonly bindingToken: string;
}

/** Recover cleanup custody without invoking an untrusted lease accessor. */
export function possibleLinkedOriginalRelease(
	value: unknown,
): (() => PromiseLike<void> | void) | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'release');
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		&& typeof descriptor.value === 'function'
		? () => Reflect.apply(descriptor.value, value, []) as PromiseLike<void> | void
		: null;
}

/** Give every caller the same cleanup settlement while running release once. */
export function oneShotLinkedOriginalRelease(
	operation: () => PromiseLike<void> | void,
): () => Promise<void> {
	let result: Promise<void> | null = null;
	return () => {
		result ??= Promise.resolve().then(operation);
		return result;
	};
}

/** Compare normalized binding generations without reducing identity to the CAS token. */
export function sameLinkedOriginalBinding<Binding extends LinkedOriginalBindingIdentity>(
	left: Binding,
	right: Binding,
): boolean {
	return left.bindingToken === right.bindingToken && JSON.stringify(left) === JSON.stringify(right);
}
