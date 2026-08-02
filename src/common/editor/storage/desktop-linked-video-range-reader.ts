/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	DesktopReadFetch,
	DesktopReadResponse,
} from '../desktop-read-materialization.ts';
import { MEDIA_CONTENT_DIGEST_CHUNK_BYTES } from './media-content-digest.ts';

export const DESKTOP_LINKED_VIDEO_RANGE_MAXIMUM_BYTES = MEDIA_CONTENT_DIGEST_CHUNK_BYTES;

export interface DesktopLinkedVideoRangeDescriptor {
	readonly url: string;
	readonly size: number;
	readonly mimeType: string;
}

export interface DesktopLinkedVideoRangeRequest {
	readonly offset: number;
	readonly length: number;
	readonly signal?: AbortSignal;
}

/** Read one exact response without retaining more than the fixed range ceiling. */
export async function readDesktopLinkedVideoRange(
	descriptor: DesktopLinkedVideoRangeDescriptor,
	request: DesktopLinkedVideoRangeRequest,
	fetchRange: DesktopReadFetch,
): Promise<Uint8Array> {
	assertDescriptor(descriptor);
	assertRequest(request, descriptor.size);
	if (typeof fetchRange !== 'function') {
		throw new TypeError('Desktop linked-video range reads require a fetch implementation.');
	}
	throwIfAborted(request.signal);
	let response: DesktopReadResponse;
	try {
		response = await awaitWithAbort(fetchRange(descriptor.url, {
			method: 'GET',
			headers: { Range: rangeHeader(request) },
			cache: 'no-store',
			credentials: 'omit',
			...(request.signal ? { signal: request.signal } : {}),
		}), request.signal);
	} catch (error) {
		throwIfAborted(request.signal);
		throw error;
	}
	throwIfAborted(request.signal);
	assertResponse(response);
	let body = response.body;
	let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	try {
		throwIfAborted(request.signal);
		if (response.ok !== true || response.status !== 206) {
			throw new Error(`Desktop linked-video range read failed with status ${response.status || 'unknown'}.`);
		}
		if (readHeader(response, 'Accept-Ranges') !== 'bytes') {
			throw new Error('Desktop linked-video range reads require byte-range support.');
		}
		if (readHeader(response, 'Content-Range') !== rangeHeader(request, descriptor.size)) {
			throw new Error('Desktop linked-video range read returned an inexact Content-Range.');
		}
		if (readContentLength(response) !== request.length) {
			throw new Error('Desktop linked-video range read returned an inexact Content-Length.');
		}
		if (readHeader(response, 'Content-Type') !== descriptor.mimeType) {
			throw new Error('Desktop linked-video range read returned an inexact Content-Type.');
		}
		if (!body || typeof body.getReader !== 'function') {
			throw new Error('Desktop linked-video range read requires a readable body.');
		}
		reader = body.getReader();
		const bytes = new Uint8Array(request.length);
		let received = 0;
		while (true) {
			throwIfAborted(request.signal);
			const result = await awaitWithAbort(reader.read(), request.signal);
			throwIfAborted(request.signal);
			if (!result || typeof result !== 'object') {
				throw new TypeError('Desktop linked-video range read returned an invalid body result.');
			}
			if (result.done) break;
			if (!(result.value instanceof Uint8Array)) {
				throw new TypeError('Desktop linked-video range read returned non-byte body data.');
			}
			if (result.value.byteLength > request.length - received) {
				throw new Error('Desktop linked-video range read returned too many body bytes.');
			}
			bytes.set(result.value, received);
			received += result.value.byteLength;
		}
		if (received !== request.length) {
			throw new Error('Desktop linked-video range read returned too few body bytes.');
		}
		throwIfAborted(request.signal);
		return bytes;
	} catch (error) {
		let primary = error;
		try { throwIfAborted(request.signal); } catch (abortError) { primary = abortError; }
		if (reader) cancelTransport(reader, primary);
		else if (body) cancelTransport(body, primary);
		throw primary;
	} finally {
		body = null;
	}
}

function assertDescriptor(
	value: DesktopLinkedVideoRangeDescriptor,
): asserts value is DesktopLinkedVideoRangeDescriptor {
	if (!value || typeof value !== 'object' || typeof value.url !== 'string' || !value.url) {
		throw new TypeError('A desktop linked-video range descriptor is required.');
	}
	if (!Number.isSafeInteger(value.size) || value.size < 1) {
		throw new RangeError('Desktop linked-video range size must be a positive safe integer.');
	}
	if (typeof value.mimeType !== 'string' || !value.mimeType) {
		throw new TypeError('Desktop linked-video range MIME type is required.');
	}
}

function assertRequest(value: DesktopLinkedVideoRangeRequest, size: number): void {
	if (!value || typeof value !== 'object'
		|| !Number.isSafeInteger(value.offset) || value.offset < 0
		|| !Number.isSafeInteger(value.length) || value.length < 1) {
		throw new RangeError('Desktop linked-video range bounds are invalid.');
	}
	if (value.length > DESKTOP_LINKED_VIDEO_RANGE_MAXIMUM_BYTES) {
		throw new RangeError('Desktop linked-video ranges cannot exceed the fixed 4 MiB maximum.');
	}
	if (value.offset > size - value.length) {
		throw new RangeError('Desktop linked-video range exceeds the admitted file size.');
	}
}

function rangeHeader(request: DesktopLinkedVideoRangeRequest, total?: number): string {
	const range = `bytes=${request.offset}-${request.offset + request.length - 1}`;
	return total === undefined ? range : `${range.replace('=', ' ')}/${total}`;
}

function assertResponse(value: unknown): asserts value is DesktopReadResponse {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Desktop linked-video range read returned an invalid response.');
	}
}

function readHeader(response: DesktopReadResponse, name: string): string | null {
	if (!response.headers || typeof response.headers.get !== 'function') {
		throw new Error('Desktop linked-video range read requires response headers.');
	}
	return response.headers.get(name);
}

function readContentLength(response: DesktopReadResponse): number {
	const value = readHeader(response, 'Content-Length');
	if (value === null || !/^\d+$/u.test(value)) {
		throw new Error('Desktop linked-video range read requires an exact Content-Length.');
	}
	const length = Number(value);
	if (!Number.isSafeInteger(length)) {
		throw new Error('Desktop linked-video range read requires a safe Content-Length.');
	}
	return length;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') throw new DOMException('Linked-video range read cancelled.', 'AbortError');
	const error = new Error('Linked-video range read cancelled.');
	error.name = 'AbortError';
	throw error;
}

function awaitWithAbort<Value>(operation: PromiseLike<Value>, signal?: AbortSignal): Promise<Value> {
	if (!signal) return Promise.resolve(operation);
	return new Promise<Value>((resolve, reject) => {
		if (signal.aborted) {
			void Promise.resolve(operation).catch(() => undefined);
			reject(signal.reason);
			return;
		}
		let settled = false;
		const cleanup = (): void => signal.removeEventListener('abort', onAbort);
		const onAbort = (): void => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(signal.reason);
		};
		signal.addEventListener('abort', onAbort, { once: true });
		void Promise.resolve(operation).then(
			(value) => { if (!settled) { settled = true; cleanup(); resolve(value); } },
			(error: unknown) => { if (!settled) { settled = true; cleanup(); reject(error); } },
		);
	});
}

function cancelTransport(
	value: ReadableStreamDefaultReader<Uint8Array> | ReadableStream<Uint8Array>,
	reason: unknown,
): void {
	try {
		void Promise.resolve(value.cancel(reason)).catch(() => undefined);
	} catch {
		// The owner-scoped capability release remains the authoritative cleanup.
	}
}
