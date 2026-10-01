/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact data admission shared only by offline video export and its source planner. */
export function offlineVideoExportRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a plain record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	return value as Readonly<Record<string, unknown>>;
}

export function offlineVideoExportData(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name}.${key} must be an own data property.`);
	return descriptor.value;
}

export function offlineVideoExportDenseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
		throw new RangeError(`${name} must be a bounded ordinary array.`);
	}
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`${name} must be dense own data.`);
		result.push(descriptor.value);
	}
	if (Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError(`${name} cannot contain named fields.`);
	return Object.freeze(result);
}

export function offlineVideoExportBoundedId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 256) throw new TypeError(`${name} must be a bounded ID.`);
	return value;
}

