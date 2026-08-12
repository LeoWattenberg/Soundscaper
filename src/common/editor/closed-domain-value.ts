/* SPDX-License-Identifier: AGPL-3.0-only */

export type ClosedDomainRecord = Readonly<Record<string, unknown>>;

/** Read a plain closed record without invoking accessors or inherited state. */
export function readClosedDomainRecord(
	value: unknown,
	name: string,
	allowedFields: readonly string[],
	requiredFields: readonly string[] = allowedFields,
): ClosedDomainRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain object.`);
	}
	const allowed = new Set(allowedFields);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || !allowed.has(key)) {
			throw new TypeError(`${name} contains an unsupported field.`);
		}
		assertOwnDataProperty(value, key, name);
	}
	for (const field of requiredFields) {
		if (!Object.hasOwn(value, field)) throw new TypeError(`${name}.${field} is required.`);
	}
	return value as ClosedDomainRecord;
}

/** Copy one dense bounded array after verifying every entry is inert own data. */
export function readClosedDomainArray(
	value: unknown,
	name: string,
	minimumLength: number,
	maximumLength: number,
): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	if (value.length < minimumLength || value.length > maximumLength) {
		throw new RangeError(`${name} requires ${String(minimumLength)} through ${String(maximumLength)} entries.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
			throw new TypeError(`${name}[${String(index)}] must be an enumerable own data property.`);
		}
		result.push(descriptor.value);
	}
	for (const key of Reflect.ownKeys(value)) {
		if (key === 'length') continue;
		if (typeof key !== 'string' || !arrayIndex(key, value.length)) {
			throw new TypeError(`${name} contains an unsupported field.`);
		}
	}
	return Object.freeze(result);
}

export function readClosedDomainField(record: ClosedDomainRecord, field: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, field);
	if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
		throw new TypeError(`${name}.${field} must be an enumerable own data property.`);
	}
	return descriptor.value;
}

function assertOwnDataProperty(value: object, field: string, name: string): void {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
		throw new TypeError(`${name}.${field} must be an enumerable own data property.`);
	}
}

function arrayIndex(value: string, length: number): boolean {
	if (!/^(?:0|[1-9]\d*)$/u.test(value)) return false;
	const index = Number(value);
	return Number.isSafeInteger(index) && index >= 0 && index < length && String(index) === value;
}
