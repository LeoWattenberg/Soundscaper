/* SPDX-License-Identifier: AGPL-3.0-only */

export type DataRecord = Readonly<Record<string, unknown>>;

export function exactRecordById(values: readonly unknown[], id: string, name: string): DataRecord {
	const matches = dataArray(values, name).filter((value, index) => (
		stableId(ownData(value, 'id', `${name}[${String(index)}]`), `${name}[${String(index)}]`) === id
	));
	if (matches.length !== 1) throw new ReferenceError(`${name} ${id} must exist exactly once.`);
	return matches[0]!;
}

export function dataArray(value: unknown, name: string): readonly DataRecord[] {
	return Object.freeze(denseArraySnapshot(value, name)
		.map((candidate, index) => dataRecord(candidate, `${name}[${String(index)}]`)));
}

export function arrayValue(value: unknown, name: string): readonly unknown[] {
	return denseArraySnapshot(value, name);
}

export function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	let prototype: object | null;
	try {
		prototype = Object.getPrototypeOf(value) as object | null;
	} catch {
		throw new TypeError(`${name} must be a plain object.`);
	}
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain object.`);
	return value as DataRecord;
}

export function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} ID must be nonempty.`);
	return value;
}

export function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Object.is(value, -0)) {
		throw new RangeError(`${name} must be nonnegative.`);
	}
	return Number(value);
}

export function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

export function safeAdd(left: number, right: number, name: string): number {
	if (!Number.isSafeInteger(left) || left < 0 || Object.is(left, -0)
		|| !Number.isSafeInteger(right) || right < 0 || Object.is(right, -0)) {
		throw new RangeError(`${name} requires nonnegative safe frame operands.`);
	}
	const result = left + right;
	if (!Number.isSafeInteger(result) || result < 1) throw new RangeError(`${name} exceeds the safe frame range.`);
	return result;
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('Audio freeze operation aborted.', 'AbortError');
}

function denseArraySnapshot(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	let keys: readonly PropertyKey[];
	let lengthDescriptor: PropertyDescriptor | undefined;
	try {
		keys = Reflect.ownKeys(value);
		lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	} catch {
		throw new TypeError(`${name} must be a dense data-property array.`);
	}
	if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')
		|| !Number.isSafeInteger(lengthDescriptor.value) || Number(lengthDescriptor.value) < 0) {
		throw new TypeError(`${name} must be a dense data-property array.`);
	}
	const length = Number(lengthDescriptor.value);
	if (keys.length !== length + 1) throw new TypeError(`${name} must be a dense data-property array.`);
	const result: unknown[] = [];
	for (let index = 0; index < length; index += 1) {
		let descriptor: PropertyDescriptor | undefined;
		try {
			descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		} catch {
			throw new TypeError(`${name}[${String(index)}] must be an own data property.`);
		}
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${String(index)}] must be an own data property.`);
		}
		result.push(descriptor.value);
	}
	return Object.freeze(result);
}

function ownData(value: DataRecord, field: string, name: string): unknown {
	let descriptor: PropertyDescriptor | undefined;
	try {
		descriptor = Object.getOwnPropertyDescriptor(value, field);
	} catch {
		throw new TypeError(`${name}.${field} must be an own data property.`);
	}
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${field} must be an own data property.`);
	}
	return descriptor.value;
}
