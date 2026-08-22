/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

const DIGEST = /^[a-f0-9]{64}$/u;
const PUBLICATION_ID = /^[a-f0-9]{48}$/u;

export function concatenateFramescaperDesktopProjectLibraryV12Chunks(
	chunks: readonly Uint8Array[],
	byteLength: number,
): Uint8Array {
	const output = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
	if (offset !== byteLength) throw new Error('Framescaper V12 body byte length changed');
	return output;
}

export function framescaperDesktopProjectLibraryV12Binary(value: unknown): Uint8Array {
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
	throw new TypeError('Framescaper V12 publication chunk must be binary');
}

export function framescaperDesktopProjectLibraryV12PublicationId(value: unknown): string {
	if (typeof value !== 'string' || !PUBLICATION_ID.test(value)) {
		throw new TypeError('Framescaper V12 publication id is invalid');
	}
	return value;
}

export function framescaperDesktopProjectLibraryV12DenseArray(
	value: unknown,
	maximum: number,
	label: string,
): unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum
		|| Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError(`${label} must be a bounded dense array`);
	}
	return value.map((item) => item as unknown);
}

export function framescaperDesktopProjectLibraryV12ClosedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${label} has missing or unsupported fields`);
	const output = Object.create(null) as Record<Field, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label}.${field} must be an own enumerable data property`);
		}
		output[field] = descriptor.value;
	}
	return output;
}

export function framescaperDesktopProjectLibraryV12Text(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 4_096 || value.includes('\0')) {
		throw new TypeError(`Framescaper V12 ${label} is invalid`);
	}
	return value;
}

export function framescaperDesktopProjectLibraryV12NonNegative(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`Framescaper V12 ${label} is invalid`);
	}
	return value;
}

export function framescaperDesktopProjectLibraryV12Positive(value: unknown, label: string): number {
	const result = framescaperDesktopProjectLibraryV12NonNegative(value, label);
	if (result < 1) throw new RangeError(`Framescaper V12 ${label} must be positive`);
	return result;
}

export function framescaperDesktopProjectLibraryV12Digest(value: unknown, label: string): string {
	if (typeof value !== 'string' || !DIGEST.test(value)) {
		throw new TypeError(`Framescaper V12 ${label} digest is invalid`);
	}
	return value;
}

export function framescaperDesktopProjectLibraryV12Sha256(value: string | Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}
