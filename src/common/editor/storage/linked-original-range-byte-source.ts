/* SPDX-License-Identifier: AGPL-3.0-only */

import { MEDIA_CONTENT_DIGEST_CHUNK_BYTES } from './media-content-digest.ts';

export const LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES = MEDIA_CONTENT_DIGEST_CHUNK_BYTES;

export interface LinkedOriginalRangeReadRequest {
	readonly offset: number;
	readonly length: number;
	readonly signal?: AbortSignal;
}

export interface LinkedOriginalRangeByteSource {
	readonly size: number;
	readonly type: string;
	slice(
		start: number,
		end: number,
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<Uint8Array>;
}

interface LinkedOriginalRangeByteSourceOptions {
	readonly size: number;
	readonly type: string;
	readRange(
		request: LinkedOriginalRangeReadRequest,
	): PromiseLike<Uint8Array> | Uint8Array;
}

/** Exact end-exclusive slices over a provider whose individual reads stay at four MiB or less. */
export function createLinkedOriginalRangeByteSource(
	options: LinkedOriginalRangeByteSourceOptions,
): LinkedOriginalRangeByteSource {
	if (!options || typeof options !== 'object' || typeof options.readRange !== 'function') {
		throw new TypeError('A linked original range provider is required.');
	}
	const size = positiveSafeInteger(options.size, 'Linked original range byte length');
	if (typeof options.type !== 'string' || !options.type) {
		throw new TypeError('A linked original range MIME type is required.');
	}
	const type = options.type;
	const readRange = options.readRange;
	return Object.freeze({ size, type, slice });

	async function slice(
		startValue: number,
		endValue: number,
		{ signal }: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<Uint8Array> {
		const { start, end } = exactSlice(startValue, endValue, size);
		throwIfAborted(signal);
		const length = end - start;
		if (length === 0) return new Uint8Array(0);
		if (length <= LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES) {
			return readExact(start, length, signal);
		}
		const result = new Uint8Array(length);
		for (let offset = start; offset < end;) {
			const partLength = Math.min(LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES, end - offset);
			result.set(await readExact(offset, partLength, signal), offset - start);
			offset += partLength;
		}
		return result;
	}

	async function readExact(
		offset: number,
		length: number,
		signal?: AbortSignal,
	): Promise<Uint8Array> {
		let bytes: Uint8Array;
		try {
			bytes = await readRange({ offset, length, ...(signal ? { signal } : {}) });
		} catch (error) {
			throwIfAborted(signal);
			throw error;
		}
		throwIfAborted(signal);
		if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) {
			throw new Error('The linked original range provider returned inexact bytes.');
		}
		return bytes;
	}
}

function exactSlice(
	startValue: number,
	endValue: number,
	size: number,
): Readonly<{ start: number; end: number }> {
	if (!Number.isSafeInteger(startValue) || !Number.isSafeInteger(endValue)
		|| startValue < 0 || endValue < startValue || endValue > size) {
		throw new RangeError('Linked original range slice bounds are invalid.');
	}
	return { start: startValue, end: endValue };
}

function positiveSafeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${label} must be a positive safe integer.`);
	}
	return Number(value);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') {
		throw new DOMException('Linked original range access was cancelled.', 'AbortError');
	}
	const error = new Error('Linked original range access was cancelled.');
	error.name = 'AbortError';
	throw error;
}
