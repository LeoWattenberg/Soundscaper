/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	DesktopReadFetch,
	DesktopReadMaterializationDescriptor,
	DesktopReadResponse,
} from './desktop-read-materialization.ts';
import { scapeAbortReason } from './scape-abort.ts';
import {
	createScapeArchiveByteSource,
	type ScapeArchiveByteReadRequest,
	type ScapeArchiveByteSource,
} from './scape-archive-byte-source.ts';
import { PLATFORM_TRANSFER_HARD_LIMITS } from './platform/bounded-transfer.ts';

const UINT8_ARRAY = Uint8Array;
const UINT8_ARRAY_SET = Uint8Array.prototype.set;
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
	Object.getPrototypeOf(Uint8Array.prototype) as object,
	'byteLength',
)?.get;

export const DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES =
	PLATFORM_TRANSFER_HARD_LIMITS.mediaChunkBytes;

export interface DesktopScapeArchiveByteSourceOptions {
	readonly fetch: DesktopReadFetch;
}

/**
 * Adapts a desktop-owned read capability to the archive reader without giving
 * archive code authority to release or otherwise manage that capability.
 */
export function createDesktopScapeArchiveByteSource(
	descriptor: DesktopReadMaterializationDescriptor,
	options: DesktopScapeArchiveByteSourceOptions,
): ScapeArchiveByteSource {
	assertDescriptor(descriptor);
	assertOptions(options);
	const admittedDescriptor: DesktopReadMaterializationDescriptor = Object.freeze({
		url: descriptor.url,
		size: descriptor.size,
	});
	const fetchRange = options.fetch;

	let terminal = false;
	let terminalReason: unknown;
	let rejectTerminal: (reason?: unknown) => void = () => undefined;
	const terminalFailure = new Promise<never>((_resolve, reject) => {
		rejectTerminal = reject;
	});
	void terminalFailure.catch(() => undefined);
	let serialized: Promise<void> = Promise.resolve();

	const markTerminal = (reason: unknown): unknown => {
		if (terminal) return terminalReason;
		terminal = true;
		terminalReason = reason;
		rejectTerminal(reason);
		return reason;
	};

	return createScapeArchiveByteSource({
		size: admittedDescriptor.size,
		maximumReadBytes: DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES,
		read(request): Promise<Uint8Array> {
			if (terminal) return Promise.reject(terminalReason);
			const operation = serialized.then(async () => {
				if (terminal) throw terminalReason;
				if (request.signal?.aborted) throw scapeAbortReason(request.signal);
				return readExactDesktopRange(
					admittedDescriptor,
					request,
					fetchRange,
					markTerminal,
					() => terminal ? { reason: terminalReason } : null,
				);
			});
			const visible = Promise.race([operation, terminalFailure]);
			serialized = visible.then(
				() => undefined,
				() => undefined,
			);
			return visible;
		},
	});
}

async function readExactDesktopRange(
	descriptor: DesktopReadMaterializationDescriptor,
	request: ScapeArchiveByteReadRequest,
	fetchRange: DesktopReadFetch,
	markTerminal: (reason: unknown) => unknown,
	terminalState: () => Readonly<{ reason: unknown }> | null,
): Promise<Uint8Array> {
	const signal = request.signal;
	let admitted = false;
	let body: ReadableStream<Uint8Array> | null = null;
	let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	let cancelled = false;

	const cancelTransport = (reason: unknown): void => {
		if (cancelled) return;
		let cancellation: PromiseLike<unknown> | unknown;
		try {
			if (reader && typeof reader.cancel === 'function') {
				cancelled = true;
				cancellation = reader.cancel(reason);
			} else if (body && typeof body.cancel === 'function') {
				cancelled = true;
				cancellation = body.cancel(reason);
			} else {
				return;
			}
			void Promise.resolve(cancellation).catch(() => undefined);
		} catch {
			// Main-process release is the authoritative cleanup barrier; this
			// best-effort cancellation cannot replace the first transport failure.
		}
	};
	const onAbort = (): void => {
		if (!admitted || !signal) return;
		const reason = markTerminal(scapeAbortReason(signal));
		cancelTransport(reason);
	};

	try {
		if (signal?.aborted) throw scapeAbortReason(signal);
		if (signal) signal.addEventListener('abort', onAbort, { once: true });
		admitted = true;
		if (signal?.aborted) {
			onAbort();
			throw scapeAbortReason(signal);
		}
		const response: unknown = await fetchRange(descriptor.url, {
			method: 'GET',
			headers: { Range: rangeHeader(request) },
			cache: 'no-store',
			credentials: 'omit',
			...(signal ? { signal } : {}),
		});
		assertResponse(response);
		body = response.body;
		const alreadyTerminal = terminalState();
		if (alreadyTerminal) {
			cancelTransport(alreadyTerminal.reason);
			throw alreadyTerminal.reason;
		}
		if (response.ok !== true || response.status !== 206) {
			throw new Error(`Desktop .scape range read failed with status ${response.status || 'unknown'}.`);
		}
		const expectedRange = rangeHeader(request, descriptor.size);
		if (readHeader(response, 'Content-Range') !== expectedRange) {
			throw new Error('Desktop .scape range read returned an inexact Content-Range.');
		}
		if (readContentLength(response) !== request.length) {
			throw new Error('Desktop .scape range read returned an inexact Content-Length.');
		}
		if (!body || typeof body.getReader !== 'function') {
			throw new Error('Desktop .scape range read requires a readable body.');
		}
		reader = body.getReader();
		if (!reader || typeof reader.read !== 'function') {
			throw new Error('Desktop .scape range read requires a readable body reader.');
		}

		const bytes = new UINT8_ARRAY(request.length);
		let received = 0;
		while (true) {
			const result = await reader.read();
			if (!result || typeof result !== 'object') {
				throw new TypeError('Desktop .scape range read returned an invalid body result.');
			}
			if (result.done) break;
			const chunk: unknown = result.value;
			const chunkLength = nativeUint8ArrayByteLength(chunk);
			if (chunkLength === null) {
				throw new TypeError('Desktop .scape range read returned non-byte body data.');
			}
			if (chunkLength > request.length - received) {
				throw new Error('Desktop .scape range read returned too many body bytes.');
			}
			Reflect.apply(UINT8_ARRAY_SET, bytes, [chunk, received]);
			received += chunkLength;
		}
		if (received !== request.length) {
			throw new Error('Desktop .scape range read returned too few body bytes.');
		}
		return bytes;
	} catch (error) {
		if (!admitted) throw error;
		const currentTerminal = terminalState();
		const primary = currentTerminal
			? currentTerminal.reason
			: (signal?.aborted ? scapeAbortReason(signal) : error);
		const reason = markTerminal(primary);
		cancelTransport(reason);
		throw reason;
	} finally {
		if (signal) signal.removeEventListener('abort', onAbort);
	}
}

function assertDescriptor(
	descriptor: DesktopReadMaterializationDescriptor,
): asserts descriptor is DesktopReadMaterializationDescriptor {
	if (!descriptor || typeof descriptor !== 'object') {
		throw new TypeError('A desktop .scape read descriptor is required.');
	}
	if (typeof descriptor.url !== 'string' || descriptor.url.length === 0) {
		throw new TypeError('A desktop .scape read descriptor requires a URL.');
	}
	if (!Number.isSafeInteger(descriptor.size) || descriptor.size < 0) {
		throw new RangeError('Desktop .scape declared size must be a non-negative safe integer.');
	}
}

function assertOptions(
	options: DesktopScapeArchiveByteSourceOptions,
): asserts options is DesktopScapeArchiveByteSourceOptions {
	if (!options || typeof options !== 'object' || typeof options.fetch !== 'function') {
		throw new TypeError('Desktop .scape range reads require a fetch implementation.');
	}
}

function assertResponse(value: unknown): asserts value is DesktopReadResponse {
	if (!value || typeof value !== 'object') {
		throw new TypeError('Desktop .scape range read returned an invalid response.');
	}
}

function rangeHeader(request: ScapeArchiveByteReadRequest, total?: number): string {
	const range = `bytes=${request.offset}-${request.offset + request.length - 1}`;
	return total === undefined ? range : `${range.replace('=', ' ')}/${total}`;
}

function readHeader(response: DesktopReadResponse, name: string): string | null {
	if (!response.headers || typeof response.headers.get !== 'function') {
		throw new Error('Desktop .scape range read requires response headers.');
	}
	return response.headers.get(name);
}

function readContentLength(response: DesktopReadResponse): number {
	const value = readHeader(response, 'Content-Length');
	if (value === null || !/^\d+$/u.test(value)) {
		throw new Error('Desktop .scape range read requires an exact Content-Length.');
	}
	const length = Number(value);
	if (!Number.isSafeInteger(length)) {
		throw new Error('Desktop .scape range read requires a safe Content-Length.');
	}
	return length;
}

function nativeUint8ArrayByteLength(value: unknown): number | null {
	if (!(value instanceof UINT8_ARRAY) || !TYPED_ARRAY_BYTE_LENGTH_GETTER) return null;
	try {
		return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []) as number;
	} catch {
		return null;
	}
}
