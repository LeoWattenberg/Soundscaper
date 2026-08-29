/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const TEXT_ENCODER = new TextEncoder();
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = requiredGetter<number>(ArrayBuffer.prototype, 'byteLength');
const TYPED_ARRAY_BYTE_LENGTH_GETTER = requiredGetter<number>(
	Object.getPrototypeOf(Uint8Array.prototype) as object,
	'byteLength',
);
const TYPED_ARRAY_BUFFER_GETTER = requiredGetter<object>(
	Object.getPrototypeOf(Uint8Array.prototype) as object,
	'buffer',
);

/** Digest closed JSON-like authority independently of object-key insertion order. */
export function canonicalJsonSha256(value: unknown): string {
	return bytesToHex(sha256(TEXT_ENCODER.encode(canonicalJson(value, new Set<object>()))));
}

/** Digest each own enumerable root of one closed project document. */
export function canonicalJsonRootSha256(value: unknown): Readonly<Record<string, string>> {
	const candidate = record(value);
	return Object.freeze(Object.fromEntries(Object.keys(candidate).map((key) => [
		key, canonicalJsonSha256(candidate[key]),
	])));
}

function canonicalJson(value: unknown, seen: Set<object>): string {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
	if (value instanceof Uint8Array) {
		assertCanonicalUint8Array(value);
		return canonicalBinary('U', copyUint8Array(value));
	}
	if (value instanceof ArrayBuffer) {
		assertCanonicalArrayBuffer(value);
		return canonicalBinary('B', copyArrayBuffer(value));
	}
	if (ArrayBuffer.isView(value)) {
		throw new TypeError('Canonical JSON authority supports only Uint8Array and ArrayBuffer binary values.');
	}
	if (Array.isArray(value)) {
		return canonicalArray(value, seen);
	}
	const candidate = record(value);
	if (seen.has(candidate)) throw new TypeError('Canonical JSON values cannot be cyclic.');
	seen.add(candidate);
	const keys = Reflect.ownKeys(candidate);
	if (keys.some((key) => typeof key !== 'string')) {
		throw new TypeError('Canonical JSON records cannot carry symbol authority.');
	}
	const entries = (keys as string[]).sort().map((key) => {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('Canonical JSON records must contain only own enumerable data.');
		}
		return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, seen)}`;
	});
	seen.delete(candidate);
	return `{${entries.join(',')}}`;
}

function canonicalArray(value: unknown[], seen: Set<object>): string {
	if (Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError('Canonical JSON arrays must use the ordinary Array prototype.');
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	const length = lengthDescriptor?.value;
	if (!lengthDescriptor || lengthDescriptor.enumerable || !Object.hasOwn(lengthDescriptor, 'value')
		|| !Number.isSafeInteger(length) || length < 0) {
		throw new TypeError('Canonical JSON arrays must carry an ordinary data length.');
	}
	if (Reflect.ownKeys(value).length !== length + 1) {
		throw new TypeError('Canonical JSON arrays must be dense and cannot carry extra authority.');
	}
	if (seen.has(value)) throw new TypeError('Canonical JSON values cannot be cyclic.');
	seen.add(value);
	const items: string[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('Canonical JSON array indices must be own enumerable data.');
		}
		items.push(canonicalJson(descriptor.value, seen));
	}
	seen.delete(value);
	return `[${items.join(',')}]`;
}

function canonicalBinary(type: 'B' | 'U', bytes: Uint8Array): string {
	return `${type}${String(bytes.byteLength)}:${bytesToHex(bytes)}`;
}

function assertCanonicalUint8Array(value: Uint8Array): void {
	if (Object.getPrototypeOf(value) !== Uint8Array.prototype) {
		throw new TypeError('Canonical JSON Uint8Array values must use the ordinary binary prototype.');
	}
	const byteLength = intrinsicByteLength(TYPED_ARRAY_BYTE_LENGTH_GETTER, value);
	const buffer = intrinsicObject(TYPED_ARRAY_BUFFER_GETTER, value);
	if (!(buffer instanceof ArrayBuffer) || Object.getPrototypeOf(buffer) !== ArrayBuffer.prototype) {
		throw new TypeError('Canonical JSON Uint8Array values require an ordinary ArrayBuffer.');
	}
	if (Reflect.ownKeys(value).length !== byteLength) {
		throw new TypeError('Canonical JSON binary values cannot carry extra properties.');
	}
}

function assertCanonicalArrayBuffer(value: ArrayBuffer): void {
	if (Object.getPrototypeOf(value) !== ArrayBuffer.prototype || Reflect.ownKeys(value).length !== 0) {
		throw new TypeError('Canonical JSON binary values cannot carry a custom prototype or extra properties.');
	}
}

function copyUint8Array(value: Uint8Array): Uint8Array {
	try {
		const byteLength = intrinsicByteLength(TYPED_ARRAY_BYTE_LENGTH_GETTER, value);
		const bytes = new Uint8Array(byteLength);
		Uint8Array.prototype.set.call(bytes, value);
		return bytes;
	} catch (error) {
		throw closedBinaryCopyError(error);
	}
}

function copyArrayBuffer(value: ArrayBuffer): Uint8Array {
	try {
		const byteLength = intrinsicByteLength(ARRAY_BUFFER_BYTE_LENGTH_GETTER, value);
		const bytes = new Uint8Array(byteLength);
		Uint8Array.prototype.set.call(bytes, new Uint8Array(value));
		return bytes;
	} catch (error) {
		throw closedBinaryCopyError(error);
	}
}

function closedBinaryCopyError(cause: unknown): TypeError {
	return new TypeError('Canonical JSON binary authority is detached or out of bounds.', { cause });
}

function intrinsicByteLength(getter: (this: object) => number, value: object): number {
	try {
		return Reflect.apply(getter, value, []) as number;
	} catch (error) {
		throw new TypeError('Canonical JSON binary authority has an invalid receiver.', { cause: error });
	}
}

function intrinsicObject(getter: (this: object) => object, value: object): object {
	try {
		return Reflect.apply(getter, value, []) as object;
	} catch (error) {
		throw new TypeError('Canonical JSON binary authority has an invalid receiver.', { cause: error });
	}
}

function requiredGetter<Result>(target: object, key: string): (this: object) => Result {
	const getter = Object.getOwnPropertyDescriptor(target, key)?.get;
	if (!getter) throw new Error(`Missing intrinsic ${key} getter.`);
	return getter as (this: object) => Result;
}

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Canonical JSON authority must contain only plain records.');
	}
	return value as Record<string, unknown>;
}
