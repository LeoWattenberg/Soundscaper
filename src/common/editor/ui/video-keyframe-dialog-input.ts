/* SPDX-License-Identifier: AGPL-3.0-only */

export type VideoKeyframeUiDataRecord = Readonly<Record<string, unknown>>;

/** Descriptor-safe projections used by the selected V20 inspector boundary. */
export function ordinaryVideoKeyframeUiRecord(value: unknown): VideoKeyframeUiDataRecord | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null
		? value as VideoKeyframeUiDataRecord
		: null;
}

export function ordinaryVideoKeyframeUiRecords(
	value: unknown,
	name: string,
): readonly VideoKeyframeUiDataRecord[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 100_000) {
		throw new TypeError(`${name} must be a bounded ordinary array.`);
	}
	return Object.freeze(value.map((item, index) => {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${String(index)}] must be an own enumerable data property.`);
		}
		const record = ordinaryVideoKeyframeUiRecord(descriptor.value);
		if (!record) throw new TypeError(`${name}[${String(index)}] must be an ordinary object.`);
		return record;
	}));
}

export function safeVideoKeyframeUiDataProperty(
	value: VideoKeyframeUiDataRecord,
	key: string,
): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

export function requiredVideoKeyframeUiDataProperty(
	value: VideoKeyframeUiDataRecord,
	key: string,
	name: string,
): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

export function videoKeyframeUiStringArray(value: unknown, name: string): readonly string[] {
	if (!Array.isArray(value) || value.length > 100_000) throw new TypeError(`${name} must be a bounded array.`);
	return Object.freeze(value.map((item, index) => (
		canonicalVideoKeyframeUiString(item, `${name}[${String(index)}]`)
	)));
}

export function canonicalVideoKeyframeUiString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()) {
		throw new TypeError(`${name} must be a canonical non-empty string.`);
	}
	return value;
}

export function positiveVideoKeyframeUiInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

export function nonNegativeVideoKeyframeUiInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}
