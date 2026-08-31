/* SPDX-License-Identifier: AGPL-3.0-only */

export function recordWithOwnData(value: unknown, label: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label} must contain only own data properties.`);
		}
	}
	return value as Readonly<Record<string, unknown>>;
}

export function inheritedData(
	value: object,
	field: string,
): ((...args: unknown[]) => unknown) | undefined {
	let candidate: object | null = value;
	while (candidate) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
		if (descriptor) return Object.hasOwn(descriptor, 'value')
			? descriptor.value as ((...args: unknown[]) => unknown) | undefined : undefined;
		candidate = Object.getPrototypeOf(candidate) as object | null;
	}
	return undefined;
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

export function projectIdValue_(value: unknown): string {
	if (typeof value !== 'string' || !/^[\x21-\x7e]{1,256}$/u.test(value)) {
		throw new TypeError('A bounded printable Framescaper desktop project id is required.');
	}
	return value;
}

export function instant(value: unknown): string {
	const result = text(value, 'project timestamp');
	if (!Number.isFinite(Date.parse(result))) throw new TypeError('The Framescaper project timestamp is invalid.');
	return result;
}

export function text(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096) {
		throw new TypeError(`The Framescaper ${label} is invalid.`);
	}
	return value;
}

export function nonNegative(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`The Framescaper ${label} is invalid.`);
	}
	return value;
}

export function positive(value: unknown, label: string): number {
	const result = nonNegative(value, label);
	if (result < 1) throw new RangeError(`The Framescaper ${label} must be positive.`);
	return result;
}

export function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${label} has unsupported fields.`);
	}
	const output = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${field} must be an own data property.`);
		}
		output[field] = descriptor.value;
	}
	return output;
}
