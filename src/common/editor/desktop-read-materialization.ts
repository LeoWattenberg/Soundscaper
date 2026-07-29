/* SPDX-License-Identifier: AGPL-3.0-only */

import { PLATFORM_TRANSFER_HARD_LIMITS } from './platform/bounded-transfer.ts';

export const DESKTOP_READ_HARD_LIMIT_BYTES = 512 * 1024 * 1024;

export interface DesktopReadMaterializationDescriptor {
	readonly url: string;
	readonly size: number;
}

export interface DesktopReadResponse {
	readonly ok: boolean;
	readonly status: number;
	readonly headers: Pick<Headers, 'get'>;
	readonly body: ReadableStream<Uint8Array> | null;
}

export type DesktopReadFetch = (
	url: string,
	init: RequestInit,
) => Promise<DesktopReadResponse>;

export interface DesktopReadMaterializationOptions {
	readonly fetch: DesktopReadFetch;
	readonly signal: AbortSignal;
	readonly maximumBytes?: number;
}

export async function materializeDesktopReadBlob(
	descriptor: DesktopReadMaterializationDescriptor,
	options: DesktopReadMaterializationOptions,
): Promise<Blob> {
	assertDescriptor(descriptor);
	assertOptions(options);
	const maximumBytes = options.maximumBytes === undefined
		? DESKTOP_READ_HARD_LIMIT_BYTES
		: nonNegativeSafeInteger(options.maximumBytes, 'Desktop read maximumBytes');
	if (maximumBytes > DESKTOP_READ_HARD_LIMIT_BYTES) {
		throw new RangeError('Desktop read maximumBytes exceeds the non-raiseable hard limit.');
	}
	if (descriptor.size > maximumBytes) {
		throw new RangeError('The desktop read declared size exceeds its maximumBytes.');
	}

	throwIfAborted(options.signal);
	const response = await awaitWithAbort(
		options.fetch(descriptor.url, {
			cache: 'no-store',
			credentials: 'omit',
			signal: options.signal,
		}),
		options.signal,
	);
	let body: ReadableStream<Uint8Array> | null = null;
	let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	try {
		if (!response || typeof response !== 'object') {
			throw new TypeError('Desktop file read returned an invalid response.');
		}
		body = response.body;
		throwIfAborted(options.signal);
		if (!response.ok) {
			throw new Error(`Desktop file read failed with status ${response.status || 'unknown'}.`);
		}
		const contentLength = parseContentLength(response.headers);
		if (contentLength !== descriptor.size) {
			throw new Error('Desktop file read Content-Length does not match the declared size.');
		}
		if (!body || typeof body.getReader !== 'function') {
			throw new Error('Desktop file read response requires a readable body.');
		}
		reader = body.getReader();
		const retainedParts: Uint8Array<ArrayBuffer>[] = [];
		let receivedBytes = 0;
		while (true) {
			throwIfAborted(options.signal);
			const result = await awaitWithAbort(reader.read(), options.signal);
			throwIfAborted(options.signal);
			if (result.done) break;
			const chunk = result.value;
			if (!(chunk instanceof Uint8Array)) {
				throw new TypeError('Desktop file read returned a non-byte stream chunk.');
			}
			if (chunk.byteLength > descriptor.size - receivedBytes) {
				throw new Error('Desktop file read actual bytes exceed the declared size.');
			}
			receivedBytes += chunk.byteLength;
			retainBoundedCopies(retainedParts, chunk);
		}
		if (receivedBytes !== descriptor.size) {
			throw new Error('Desktop file read actual bytes do not match the declared size.');
		}
		throwIfAborted(options.signal);
		const blob = new Blob(retainedParts);
		if (blob.size !== descriptor.size) {
			throw new Error('Desktop file read Blob does not match the declared size.');
		}
		throwIfAborted(options.signal);
		return blob;
	} catch (error) {
		if (reader) cancelReader(reader, error);
		else if (body) cancelBody(body, error);
		throw error;
	}
}

function assertDescriptor(
	descriptor: DesktopReadMaterializationDescriptor,
): asserts descriptor is DesktopReadMaterializationDescriptor {
	if (!descriptor || typeof descriptor !== 'object') {
		throw new TypeError('A desktop read descriptor is required.');
	}
	if (typeof descriptor.url !== 'string' || descriptor.url.length === 0) {
		throw new TypeError('A desktop read descriptor requires a URL.');
	}
	nonNegativeSafeInteger(descriptor.size, 'Desktop read declared size');
}

function assertOptions(
	options: DesktopReadMaterializationOptions,
): asserts options is DesktopReadMaterializationOptions {
	if (!options || typeof options !== 'object' || typeof options.fetch !== 'function') {
		throw new TypeError('Desktop read materialization requires a fetch implementation.');
	}
	const signal = options.signal;
	if (!signal || typeof signal !== 'object'
		|| typeof signal.addEventListener !== 'function'
		|| typeof signal.removeEventListener !== 'function') {
		throw new TypeError('Desktop read materialization requires an AbortSignal.');
	}
}

function nonNegativeSafeInteger(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${label} must be a non-negative safe integer.`);
	}
	return value;
}

function parseContentLength(headers: Pick<Headers, 'get'>): number {
	const value = headers?.get?.('Content-Length');
	if (value === null || value === undefined || !/^\d+$/u.test(value)) {
		throw new Error('Desktop file read requires an exact Content-Length.');
	}
	const contentLength = Number(value);
	if (!Number.isSafeInteger(contentLength)) {
		throw new Error('Desktop file read requires a safe Content-Length.');
	}
	return contentLength;
}

function retainBoundedCopies(
	parts: Uint8Array<ArrayBuffer>[],
	chunk: Uint8Array,
): void {
	for (let offset = 0; offset < chunk.byteLength; offset += PLATFORM_TRANSFER_HARD_LIMITS.mediaChunkBytes) {
		const length = Math.min(
			PLATFORM_TRANSFER_HARD_LIMITS.mediaChunkBytes,
			chunk.byteLength - offset,
		);
		const retained = new Uint8Array(length);
		retained.set(chunk.subarray(offset, offset + length));
		parts.push(retained);
	}
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason;
}

function awaitWithAbort<Value>(
	operation: PromiseLike<Value>,
	signal: AbortSignal,
): Promise<Value> {
	return new Promise<Value>((resolvePromise, rejectPromise) => {
		if (signal.aborted) {
			rejectPromise(signal.reason);
			return;
		}
		let settled = false;
		const cleanup = (): void => {
			signal.removeEventListener('abort', handleAbort);
		};
		const handleAbort = (): void => {
			if (settled) return;
			settled = true;
			cleanup();
			rejectPromise(signal.reason);
		};
		signal.addEventListener('abort', handleAbort, { once: true });
		void Promise.resolve(operation).then(
			(value) => {
				if (settled) return;
				settled = true;
				cleanup();
				resolvePromise(value);
			},
			(error: unknown) => {
				if (settled) return;
				settled = true;
				cleanup();
				rejectPromise(error);
			},
		);
	});
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>, reason: unknown): void {
	try {
		void Promise.resolve(reader.cancel(reason)).catch(() => undefined);
	} catch {
		// Cancellation is best-effort cleanup and must not replace the primary failure.
	}
}

function cancelBody(body: ReadableStream<Uint8Array>, reason: unknown): void {
	try {
		void Promise.resolve(body.cancel(reason)).catch(() => undefined);
	} catch {
		// Cancellation is best-effort cleanup and must not replace the primary failure.
	}
}
