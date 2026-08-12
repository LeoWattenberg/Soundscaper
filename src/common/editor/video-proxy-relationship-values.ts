/* SPDX-License-Identifier: AGPL-3.0-only */

/** Descriptor-safe value helpers owned by the dormant proxy relationship seam. */
export function closedDataRecord(
	value: unknown,
	allowed: readonly string[],
	name: string,
	required: readonly string[] = allowed,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a closed object.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a closed object.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !allowed.includes(key))
		|| required.some((key) => !keys.includes(key))) {
		throw new TypeError(`${name} has unsupported, missing, or extra fields.`);
	}
	const result: Record<string, unknown> = {};
	const record = value as Record<string, unknown>;
	for (const key of keys as string[]) result[key] = dataProperty(record, key, name);
	return result;
}

export function dataRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be an object.`);
	}
	return value as Record<string, unknown>;
}

export function deepFreeze<Value>(value: Value, seen = new Set<object>()): Value {
	if (!value || typeof value !== 'object' || seen.has(value)) return value;
	if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return value;
	seen.add(value);
	for (const nested of Object.values(value)) deepFreeze(nested, seen);
	return Object.freeze(value);
}

export function dataProperty(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property, not an accessor.`);
	}
	return descriptor.value;
}

export function dataArrayProperty(
	value: Record<string, unknown>,
	key: string,
	name: string,
): readonly unknown[] {
	const raw = dataProperty(value, key, name);
	if (!Array.isArray(raw)) throw new TypeError(`${name} must be an array.`);
	const lengthDescriptor = Object.getOwnPropertyDescriptor(raw, 'length');
	const length = lengthDescriptor?.value;
	if (!Number.isSafeInteger(length) || Number(length) < 0) {
		throw new TypeError(`${name} length is invalid.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < Number(length); index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(raw, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${String(index)}] must be an enumerable data property.`);
		}
		result.push(descriptor.value);
	}
	return result;
}

export function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new TypeError(`${name} must be a non-empty string.`);
	}
	return value;
}

export function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be positive.`);
	}
	return Number(value);
}
