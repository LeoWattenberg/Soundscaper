/* SPDX-License-Identifier: AGPL-3.0-only */

export const VIDEO_RETIME_EXPORT_MAXIMUM_JSON_BYTES = 8 * 1024 * 1024;

/** Count canonical JSON UTF-8 bytes without first allocating the JSON string. */
export function videoRetimeCanonicalJsonByteLength(value: unknown): number {
	return jsonBytes(value, new Set<object>());
}

/** Count one JSON string token, including its quotes and required escapes. */
export function videoRetimeJsonStringTokenByteLength(value: string): number {
	let bytes = 2;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code === 0x22 || code === 0x5c) bytes += 2;
		else if (code <= 0x1f) {
			bytes += code === 0x08 || code === 0x09 || code === 0x0a
				|| code === 0x0c || code === 0x0d ? 2 : 6;
		} else if (isHighSurrogate(code)) {
			const next = value.charCodeAt(index + 1);
			if (isLowSurrogate(next)) {
				bytes += 4;
				index += 1;
			} else bytes += 6;
		} else if (isLowSurrogate(code)) bytes += 6;
		else if (code <= 0x7f) bytes += 1;
		else if (code <= 0x7ff) bytes += 2;
		else bytes += 3;
	}
	return bytes;
}

function jsonBytes(value: unknown, seen: Set<object>): number {
	if (value === null) return 4;
	if (typeof value === 'string') return videoRetimeJsonStringTokenByteLength(value);
	if (typeof value === 'boolean') return value ? 4 : 5;
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
			throw new TypeError('Video retime export JSON numbers must be safe canonical integers.');
		}
		return String(value).length;
	}
	if (typeof value !== 'object') {
		throw new TypeError('Video retime export intent contains a non-JSON value.');
	}
	if (seen.has(value)) throw new TypeError('Video retime export intent cannot contain a cycle.');
	seen.add(value);
	let bytes: number;
	if (Array.isArray(value)) {
		assertDenseDataArray(value);
		bytes = 2;
		for (let index = 0; index < value.length; index += 1) {
			bytes = checkedAdd(bytes, index === 0 ? 0 : 1);
			bytes = checkedAdd(bytes, jsonBytes(value[index], seen));
		}
	} else {
		const record = value as Record<string, unknown>;
		if (Object.getPrototypeOf(record) !== Object.prototype
			&& Object.getPrototypeOf(record) !== null) {
			throw new TypeError('Video retime export intent records must have a plain prototype.');
		}
		const keys = Reflect.ownKeys(record);
		bytes = 2;
		for (const [index, key] of keys.entries()) {
			if (typeof key !== 'string') throw new TypeError('Video retime export intent cannot contain symbols.');
			const descriptor = Object.getOwnPropertyDescriptor(record, key);
			if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw new TypeError('Video retime export intent requires enumerable data properties.');
			}
			bytes = checkedAdd(bytes, index === 0 ? 0 : 1);
			bytes = checkedAdd(bytes, videoRetimeJsonStringTokenByteLength(key));
			bytes = checkedAdd(bytes, 1);
			bytes = checkedAdd(bytes, jsonBytes(descriptor.value, seen));
		}
	}
	seen.delete(value);
	return bytes;
}

function assertDenseDataArray(value: readonly unknown[]): void {
	if (Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError('Video retime export intent arrays must have the standard prototype.');
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== value.length + 1 || !keys.includes('length')) {
		throw new TypeError('Video retime export intent arrays must be dense and carry no extra keys.');
	}
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('Video retime export intent arrays must contain data elements.');
		}
	}
}

function checkedAdd(left: number, right: number): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError('Video retime export JSON byte count is unsafe.');
	return result;
}

function isHighSurrogate(value: number): boolean {
	return value >= 0xd800 && value <= 0xdbff;
}

function isLowSurrogate(value: number): boolean {
	return value >= 0xdc00 && value <= 0xdfff;
}
