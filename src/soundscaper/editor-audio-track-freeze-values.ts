/* SPDX-License-Identifier: AGPL-3.0-only */

export type DataRecord = Readonly<Record<string, unknown>>;

export function exactRecordById(values: readonly unknown[], id: string, name: string): DataRecord {
	const matches = values.filter((value) => dataRecord(value, name).id === id);
	if (matches.length !== 1) throw new ReferenceError(`${name} ${id} must exist exactly once.`);
	return dataRecord(matches[0], `${name} ${id}`);
}

export function dataArray(value: unknown, name: string): readonly DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => dataRecord(candidate, `${name}[${String(index)}]`));
}

export function arrayValue(value: unknown, name: string): readonly unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value;
}

export function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

export function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} ID must be nonempty.`);
	return value;
}

export function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} must be nonnegative.`);
	return Number(value);
}

export function positiveInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new RangeError(`${name} must be positive.`);
	return Number(value);
}

export function safeAdd(left: number, right: number, name: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result) || result < 1) throw new RangeError(`${name} exceeds the safe frame range.`);
	return result;
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('Audio freeze operation aborted.', 'AbortError');
}
