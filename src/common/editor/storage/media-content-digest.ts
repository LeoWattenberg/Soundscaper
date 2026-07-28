/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const nativeBlobSlice = Blob.prototype.slice;
const nativeBlobSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get;
const nativeBlobType = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')?.get;

/**
 * The default and hard maximum Blob.slice().arrayBuffer() span used while
 * hashing retained media. Callers may choose a smaller span for constrained
 * environments, but cannot raise this 4 MiB resident-read bound.
 */
export const MEDIA_CONTENT_DIGEST_CHUNK_BYTES = 4 * 1024 * 1024;

export interface MediaContentDigestOptions {
	readonly chunkBytes?: number;
	readonly signal?: AbortSignal;
}

export interface MediaContentDigestBlobSlice {
	arrayBuffer(): Promise<ArrayBuffer>;
}

/** Minimal Blob shape accepted from browser, IndexedDB, and OPFS repositories. */
export interface MediaContentDigestBlob {
	readonly size: number;
	slice(start?: number, end?: number): MediaContentDigestBlobSlice;
}

/**
 * Returns a plain native Blob view of a genuine Blob or File's complete byte
 * sequence. Captured platform intrinsics bypass subclass overrides so the
 * returned object can be shared by hashing and durable storage.
 */
export function canonicalMediaContentBlob(input: unknown): Blob {
	try {
		if (!nativeBlobSize || !nativeBlobType) throw new TypeError();
		const size = Reflect.apply(nativeBlobSize, input, []) as unknown;
		const type = Reflect.apply(nativeBlobType, input, []) as unknown;
		if (!Number.isSafeInteger(size) || Number(size) < 0 || typeof type !== 'string') {
			throw new TypeError();
		}
		const canonical = Reflect.apply(nativeBlobSlice, input, [0, size, type]) as unknown;
		if (!(canonical instanceof Blob)) throw new TypeError();
		return canonical;
	} catch {
		throw new TypeError('Retained media content must be a genuine Blob or File.');
	}
}

/** Incrementally returns the lowercase SHA-256 of a retained media Blob. */
export async function digestMediaContent(
	blob: MediaContentDigestBlob,
	options: MediaContentDigestOptions = {},
): Promise<string> {
	const signal = options.signal;
	throwIfAborted(signal);
	const blobSize = nonNegativeSafeInteger(blob?.size, 'Blob size');
	const chunkBytes = positiveSafeInteger(
		options.chunkBytes ?? MEDIA_CONTENT_DIGEST_CHUNK_BYTES,
		'chunkBytes',
	);
	if (chunkBytes > MEDIA_CONTENT_DIGEST_CHUNK_BYTES) {
		throw new RangeError('chunkBytes exceeds the media content digest hard limit.');
	}
	if (!blob || typeof blob.slice !== 'function') {
		throw new TypeError('Media content must provide Blob.slice().');
	}

	const digest = sha256.create();
	for (let start = 0; start < blobSize;) {
		throwIfAborted(signal);
		const requestedBytes = Math.min(chunkBytes, blobSize - start);
		const end = start + requestedBytes;
		const part = blob.slice(start, end);
		if (!part || typeof part.arrayBuffer !== 'function') {
			throw new TypeError('Media content Blob slices must provide arrayBuffer().');
		}
		let buffer: ArrayBuffer;
		try {
			buffer = await part.arrayBuffer();
		} catch (error) {
			throwIfAborted(signal);
			throw error;
		}
		throwIfAborted(signal);
		if (!(buffer instanceof ArrayBuffer)) {
			throw new TypeError('Media content Blob slice arrayBuffer() must return an ArrayBuffer.');
		}
		if (buffer.byteLength !== requestedBytes) {
			throw new Error(
				`Media content Blob slice returned ${buffer.byteLength} bytes; expected ${requestedBytes}.`,
			);
		}
		digest.update(new Uint8Array(buffer));
		start = end;
	}
	return bytesToHex(digest.digest());
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') {
		throw new DOMException('Media content hashing was cancelled.', 'AbortError');
	}
	const error = new Error('Media content hashing was cancelled.');
	error.name = 'AbortError';
	throw error;
}

function positiveSafeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${label} must be a positive safe integer.`);
	}
	return Number(value);
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`${label} must be a non-negative safe integer.`);
	}
	return Number(value);
}
