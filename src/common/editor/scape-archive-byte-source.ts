/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	awaitScapeReadOperation,
	throwIfScapeAborted,
} from './scape-abort.ts';
import { SCAPE_MAXIMUM_CENTRAL_DIRECTORY_BYTES } from './scape-archive-zip-profile.ts';

const BLOB_SIZE_GETTER = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get;
const BLOB_SLICE = Blob.prototype.slice;
const SOURCES = new WeakSet<object>();
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
	Object.getPrototypeOf(Uint8Array.prototype) as object,
	'byteLength',
)?.get;
const UINT8_ARRAY = Uint8Array;
const UINT8_ARRAY_SET = Uint8Array.prototype.set;

/** Zip.js may request the entire already-bounded central directory in one read. */
export const SCAPE_ARCHIVE_BYTE_SOURCE_MAXIMUM_READ_BYTES = SCAPE_MAXIMUM_CENTRAL_DIRECTORY_BYTES;

export interface ScapeArchiveByteReadRequest {
	readonly offset: number;
	readonly length: number;
	readonly signal?: AbortSignal;
}

export interface ScapeArchiveByteSource {
	readonly maximumReadBytes: number;
	readonly size: number;
	read(request: ScapeArchiveByteReadRequest): Promise<Uint8Array>;
}

export interface ScapeArchiveByteSourceOptions {
	readonly maximumReadBytes?: number;
	readonly size: number;
	readonly read: (
		request: ScapeArchiveByteReadRequest,
	) => PromiseLike<Uint8Array> | Uint8Array;
}

export function createScapeArchiveByteSource(
	options: ScapeArchiveByteSourceOptions,
): ScapeArchiveByteSource {
	if (!options || typeof options !== 'object' || typeof options.read !== 'function') {
		throw new TypeError('A Scape byte-source read provider is required.');
	}
	const size = safeNonNegativeInteger(options.size, 'The Scape byte source requires a safe non-negative size.');
	const maximumReadBytes = options.maximumReadBytes === undefined
		? SCAPE_ARCHIVE_BYTE_SOURCE_MAXIMUM_READ_BYTES
		: safePositiveReadLimit(options.maximumReadBytes);
	const provider = options.read;
	const source: ScapeArchiveByteSource = Object.freeze({
		maximumReadBytes,
		size,
		async read(request: ScapeArchiveByteReadRequest): Promise<Uint8Array> {
			const normalized = normalizeReadRequest(request, size, maximumReadBytes);
			throwIfScapeAborted(normalized.signal);
			if (normalized.length === 0) return new Uint8Array();
			let value: unknown;
			try {
				value = await awaitScapeReadOperation(
					() => provider(normalized),
					normalized.signal,
				);
			} catch (error) {
				throwIfScapeAborted(normalized.signal);
				throw error;
			}
			throwIfScapeAborted(normalized.signal);
			const byteLength = nativeUint8ArrayByteLength(value);
			if (byteLength === null) {
				throw new TypeError('The Scape byte source returned a non-byte range.');
			}
			if (byteLength !== normalized.length) {
				throw new Error('The Scape byte source returned an incomplete byte range.');
			}
			const bytes = new UINT8_ARRAY(byteLength);
			Reflect.apply(UINT8_ARRAY_SET, bytes, [value]);
			return bytes;
		},
	});
	SOURCES.add(source);
	return source;
}

export async function readScapeArchiveByteRange(
	source: ScapeArchiveByteSource,
	request: ScapeArchiveByteReadRequest,
): Promise<Uint8Array> {
	assertScapeArchiveByteSource(source);
	const normalized = normalizeReadRequest(
		request,
		source.size,
		SCAPE_ARCHIVE_BYTE_SOURCE_MAXIMUM_READ_BYTES,
	);
	throwIfScapeAborted(normalized.signal);
	if (normalized.length === 0) return new Uint8Array();
	if (normalized.length <= source.maximumReadBytes) {
		return source.read(normalized);
	}
	const bytes = new Uint8Array(normalized.length);
	let written = 0;
	while (written < normalized.length) {
		throwIfScapeAborted(normalized.signal);
		const length = Math.min(source.maximumReadBytes, normalized.length - written);
		const chunk = await source.read({
			offset: normalized.offset + written,
			length,
			...(normalized.signal ? { signal: normalized.signal } : {}),
		});
		throwIfScapeAborted(normalized.signal);
		bytes.set(chunk, written);
		written += chunk.byteLength;
	}
	return bytes;
}

export function createBlobScapeArchiveByteSource(input: Blob): ScapeArchiveByteSource {
	if (!(input instanceof Blob)) throw new TypeError('A Scape Blob is required.');
	if (!BLOB_SIZE_GETTER) throw new Error('The platform Blob size getter is unavailable.');
	const size = Reflect.apply(BLOB_SIZE_GETTER, input, []) as number;
	const blob = Reflect.apply(BLOB_SLICE, input, [0, size]) as Blob;
	return createScapeArchiveByteSource({
		size,
		async read({ offset, length }): Promise<Uint8Array> {
			const range = Reflect.apply(BLOB_SLICE, blob, [offset, offset + length]) as Blob;
			return new Uint8Array(await range.arrayBuffer());
		},
	});
}

export function assertScapeArchiveByteSource(
	value: unknown,
): asserts value is ScapeArchiveByteSource {
	if (!value || typeof value !== 'object' || !SOURCES.has(value)) {
		throw new TypeError('A trusted Scape archive byte source is required.');
	}
}

function normalizeReadRequest(
	request: ScapeArchiveByteReadRequest,
	size: number,
	maximumReadBytes: number,
): ScapeArchiveByteReadRequest {
	if (!request || typeof request !== 'object') {
		throw new TypeError('A Scape byte-range request is required.');
	}
	const offset = safeNonNegativeInteger(request.offset, 'The Scape byte range has an invalid offset.');
	const length = safeNonNegativeInteger(request.length, 'The Scape byte range has an invalid length.');
	if (length > maximumReadBytes) {
		throw new RangeError('The Scape byte source requested an unbounded byte range.');
	}
	if (offset > size - length) {
		throw new RangeError('The Scape byte source requested an invalid byte range.');
	}
	return Object.freeze({
		offset,
		length,
		...(request.signal ? { signal: request.signal } : {}),
	});
}

function safePositiveReadLimit(value: number): number {
	const limit = safeNonNegativeInteger(
		value,
		'The Scape byte-source maximum read must be a safe positive integer.',
	);
	if (limit === 0) {
		throw new RangeError('The Scape byte-source maximum read must be a safe positive integer.');
	}
	if (limit > SCAPE_ARCHIVE_BYTE_SOURCE_MAXIMUM_READ_BYTES) {
		throw new RangeError('The Scape byte-source maximum read exceeds its hard limit.');
	}
	return limit;
}

function safeNonNegativeInteger(value: number, message: string): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(message);
	return value;
}

function nativeUint8ArrayByteLength(value: unknown): number | null {
	if (!(value instanceof UINT8_ARRAY) || !TYPED_ARRAY_BYTE_LENGTH_GETTER) return null;
	try {
		return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
	} catch {
		return null;
	}
}
