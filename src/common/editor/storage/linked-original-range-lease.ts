/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	createLinkedOriginalRangeByteSource,
	LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES,
	type LinkedOriginalRangeByteSource,
	type LinkedOriginalRangeReadRequest,
} from './linked-original-range-byte-source.ts';

export interface LinkedOriginalRangeLease {
	readonly locatorRevision: unknown;
	readonly byteLength: unknown;
	readonly mimeType: unknown;
	readRange(
		request: LinkedOriginalRangeReadRequest,
	): PromiseLike<Uint8Array> | Uint8Array;
	release(): PromiseLike<void> | void;
}

export interface VerifiedLinkedOriginalRangeLease {
	readonly source: LinkedOriginalRangeByteSource;
	release(): Promise<void>;
}

interface ExpectedLinkedOriginalRange {
	readonly locatorRevision: string;
	readonly byteLength: number;
	readonly mimeType: string;
	readonly sha256: string;
}

/** Admit and hash one raw platform lease, cleaning it up on every failed path. */
export async function verifyLinkedOriginalRangeLease(
	rawLease: LinkedOriginalRangeLease | null,
	expected: ExpectedLinkedOriginalRange,
	signal?: AbortSignal,
): Promise<VerifiedLinkedOriginalRangeLease> {
	const rawRelease = possibleRangeRelease(rawLease);
	let release = rawRelease ? oneShotRelease(rawRelease) : null;
	try {
		throwIfAborted(signal);
		if (rawLease === null) {
			throw new Error('The linked original range is unavailable or changed.');
		}
		const lease = rangeLeaseValue(rawLease);
		release ??= oneShotRelease(() => lease.release());
		if (lease.locatorRevision !== expected.locatorRevision) {
			throw new Error('The linked original locator changed during range admission.');
		}
		if (lease.byteLength !== expected.byteLength) {
			throw new Error('The linked original changed byte length before range access.');
		}
		if (lease.mimeType !== expected.mimeType) {
			throw new Error('The linked original changed MIME type before range access.');
		}
		const source = createLinkedOriginalRangeByteSource({
			size: lease.byteLength,
			type: lease.mimeType,
			readRange: lease.readRange,
		});
		await verifyRangeDigest(source, expected.sha256, signal);
		return Object.freeze({ source, release });
	} catch (error) {
		if (release) return failLinkedOriginalRangeLease(error, release);
		throw error;
	}
}

/** Preserve the primary failure while still enforcing owned lease cleanup. */
export async function failLinkedOriginalRangeLease(
	error: unknown,
	release: () => Promise<void>,
): Promise<never> {
	try {
		await release();
	} catch (cleanupError) {
		throw new AggregateError(
			[error, cleanupError],
			'Linked original range verification and cleanup both failed.',
			{ cause: error },
		);
	}
	throw error;
}

function rangeLeaseValue(value: LinkedOriginalRangeLease): Readonly<{
	locatorRevision: string;
	byteLength: number;
	mimeType: string;
	readRange(request: LinkedOriginalRangeReadRequest): PromiseLike<Uint8Array> | Uint8Array;
	release(): PromiseLike<void> | void;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked original range lease is required.');
	}
	const fields = ['locatorRevision', 'byteLength', 'mimeType', 'readRange', 'release'];
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(String(key)))) {
		throw new TypeError('A linked original range lease must be a closed object.');
	}
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError('A linked original range lease must use enumerable data fields.');
		}
	}
	if (!Number.isSafeInteger(value.byteLength) || Number(value.byteLength) < 1) {
		throw new RangeError('A linked original range lease requires a positive byte length.');
	}
	if (typeof value.locatorRevision !== 'string' || !value.locatorRevision) {
		throw new TypeError('A linked original range lease requires a locator revision.');
	}
	if (typeof value.mimeType !== 'string' || !value.mimeType) {
		throw new TypeError('A linked original range lease requires a MIME type.');
	}
	if (typeof value.readRange !== 'function' || typeof value.release !== 'function') {
		throw new TypeError('A linked original range lease requires owned range operations.');
	}
	const readRange = value.readRange;
	const release = value.release;
	return Object.freeze({
		locatorRevision: value.locatorRevision,
		byteLength: Number(value.byteLength),
		mimeType: value.mimeType,
		readRange: (request: LinkedOriginalRangeReadRequest) => Reflect.apply(
			readRange,
			value,
			[request],
		) as PromiseLike<Uint8Array> | Uint8Array,
		release: () => Reflect.apply(release, value, []) as PromiseLike<void> | void,
	});
}

function possibleRangeRelease(value: unknown): (() => PromiseLike<void> | void) | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'release');
	return descriptor?.enumerable && Object.hasOwn(descriptor, 'value')
		&& typeof descriptor.value === 'function'
		? () => Reflect.apply(descriptor.value, value, []) as PromiseLike<void> | void
		: null;
}

async function verifyRangeDigest(
	source: LinkedOriginalRangeByteSource,
	expectedSha256: string,
	signal?: AbortSignal,
): Promise<void> {
	const digest = sha256.create();
	for (let offset = 0; offset < source.size;) {
		throwIfAborted(signal);
		const length = Math.min(LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES, source.size - offset);
		const bytes = await source.slice(offset, offset + length, signal ? { signal } : {});
		digest.update(bytes);
		offset += length;
	}
	throwIfAborted(signal);
	if (bytesToHex(digest.digest()) !== expectedSha256) {
		throw new Error('The linked original range failed SHA-256 verification.');
	}
}

function oneShotRelease(operation: () => PromiseLike<void> | void): () => Promise<void> {
	let result: Promise<void> | null = null;
	return () => {
		result ??= Promise.resolve().then(operation);
		return result;
	};
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
