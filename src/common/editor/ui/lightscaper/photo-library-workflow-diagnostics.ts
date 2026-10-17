/* SPDX-License-Identifier: AGPL-3.0-only */

export function message(failure: unknown): string {
	try {
		const descriptor = failure && typeof failure === 'object' ? Object.getOwnPropertyDescriptor(failure, 'message') : undefined;
		if (descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string') return descriptor.value.slice(0, 2_048);
	} catch { /* A diagnostic must never revoke an operation's outcome. */ }
	return 'The photo library action failed.';
}

export function errorCode(value: unknown): unknown {
	try { return value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'code')?.value as unknown : undefined; }
	catch { return undefined; }
}
