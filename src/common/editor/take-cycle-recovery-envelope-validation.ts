/* SPDX-License-Identifier: AGPL-3.0-only */

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type TakeCycleDataRecord = Readonly<Record<string, unknown>>;

export function closedRecord(
	value: unknown,
	name: string,
	requiredKeys: readonly string[],
): TakeCycleDataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${name} must be a closed data record.`);
	}
	const record = value as Record<PropertyKey, unknown>;
	const keys = Reflect.ownKeys(record);
	const allowed = new Set(requiredKeys);
	if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))
		|| requiredKeys.some((key) => !keys.includes(key))) {
		throw new TypeError(`${name} has an invalid closed shape.`);
	}
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} must be an enumerable data property.`);
		}
		result[key] = descriptor.value;
	}
	return Object.freeze(result);
}

export function denseArray(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > 4_096 || Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`${name} must be a bounded standard dense data array.`);
	}
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} must contain only enumerable data items.`);
		}
	}
	return Object.freeze([...value]);
}

export function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > 256
		|| /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`${name} must be a canonical stable identity.`);
	}
	return value;
}

export function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
		throw new TypeError(`${name} must be a canonical lowercase SHA-256 digest.`);
	}
	return value;
}

export function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

export function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}
