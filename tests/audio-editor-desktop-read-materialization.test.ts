/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
	DESKTOP_READ_HARD_LIMIT_BYTES,
	materializeDesktopReadBlob,
	type DesktopReadFetch,
	type DesktopReadResponse,
} from '../src/common/editor/desktop-read-materialization.ts';
import { PLATFORM_TRANSFER_HARD_LIMITS } from '../src/common/editor/platform/bounded-transfer.ts';

test('desktop read materialization streams an exact response and forwards its AbortSignal', async () => {
	const controller = new AbortController();
	const response = new Response(Uint8Array.of(1, 2, 3, 4), {
		headers: { 'Content-Length': '4' },
	});
	let requestedUrl = '';
	let requestInit: RequestInit | undefined;
	let blobCalls = 0;
	Object.defineProperty(response, 'blob', {
		value: async () => {
			blobCalls += 1;
			throw new Error('response.blob() must not be called');
		},
	});
	const fetchFile: DesktopReadFetch = async (url, init) => {
		requestedUrl = url;
		requestInit = init;
		return response;
	};

	const blob = await materializeDesktopReadBlob(
		{ url: 'soundscaper-app://bundle/_desktop/read/token/session.wav', size: 4 },
		{ fetch: fetchFile, signal: controller.signal },
	);

	assert.equal(DESKTOP_READ_HARD_LIMIT_BYTES, 512 * 1024 * 1024);
	assert.equal(requestedUrl, 'soundscaper-app://bundle/_desktop/read/token/session.wav');
	assert.equal(requestInit?.signal, controller.signal);
	assert.equal(blobCalls, 0);
	assert.equal(blob.size, 4);
	assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), Uint8Array.of(1, 2, 3, 4));
});

test('declared size and a lower non-raiseable ceiling are validated before fetch', async () => {
	const controller = new AbortController();
	let fetchCalls = 0;
	const fetchFile: DesktopReadFetch = async () => {
		fetchCalls += 1;
		return new Response(new Uint8Array(0), { headers: { 'Content-Length': '0' } });
	};
	const options = { fetch: fetchFile, signal: controller.signal };

	for (const size of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
		await assert.rejects(
			() => materializeDesktopReadBlob({ url: 'soundscaper-app://bundle/read', size }, options),
			/non-negative safe integer/iu,
		);
	}
	for (const maximumBytes of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
		await assert.rejects(
			() => materializeDesktopReadBlob(
				{ url: 'soundscaper-app://bundle/read', size: 0 },
				{ ...options, maximumBytes },
			),
			/non-negative safe integer/iu,
		);
	}
	await assert.rejects(
		() => materializeDesktopReadBlob(
			{ url: 'soundscaper-app://bundle/read', size: 0 },
			{ ...options, maximumBytes: DESKTOP_READ_HARD_LIMIT_BYTES + 1 },
		),
		/non-raiseable|hard limit/iu,
	);
	await assert.rejects(
		() => materializeDesktopReadBlob(
			{ url: 'soundscaper-app://bundle/read', size: 4 },
			{ ...options, maximumBytes: 3 },
		),
		/declared size.*maximum|maximum.*declared size/iu,
	);
	await assert.rejects(
		() => materializeDesktopReadBlob(
			{ url: 'soundscaper-app://bundle/read', size: DESKTOP_READ_HARD_LIMIT_BYTES + 1 },
			options,
		),
		/declared size.*maximum|maximum.*declared size/iu,
	);
	assert.equal(fetchCalls, 0);

	const empty = await materializeDesktopReadBlob(
		{ url: 'soundscaper-app://bundle/read', size: 0 },
		{ ...options, maximumBytes: 0 },
	);
	assert.equal(empty.size, 0);
	assert.equal(fetchCalls, 1);
});

test('HTTP status, Content-Length, and readable body must exactly match the descriptor', async () => {
	const controller = new AbortController();
	const descriptor = { url: 'soundscaper-app://bundle/read', size: 2 };
	const cases: readonly Readonly<{
		label: string;
		response: DesktopReadResponse;
		pattern: RegExp;
	}>[] = [
		{
			label: 'failed status',
			response: new Response('no', { status: 503 }),
			pattern: /status 503/iu,
		},
		{
			label: 'missing header',
			response: new Response(Uint8Array.of(1, 2)),
			pattern: /Content-Length/iu,
		},
		{
			label: 'malformed header',
			response: new Response(Uint8Array.of(1, 2), { headers: { 'Content-Length': '2.0' } }),
			pattern: /Content-Length/iu,
		},
		{
			label: 'unsafe header',
			response: new Response(Uint8Array.of(1, 2), {
				headers: { 'Content-Length': String(Number.MAX_SAFE_INTEGER + 1) },
			}),
			pattern: /Content-Length/iu,
		},
		{
			label: 'mismatched header',
			response: new Response(Uint8Array.of(1, 2), { headers: { 'Content-Length': '3' } }),
			pattern: /Content-Length.*declared size|declared size.*Content-Length/iu,
		},
		{
			label: 'missing body',
			response: {
				ok: true,
				status: 200,
				headers: new Headers({ 'Content-Length': '2' }),
				body: null,
			},
			pattern: /readable body/iu,
		},
	];

	for (const fixture of cases) {
		await assert.rejects(
			() => materializeDesktopReadBlob(descriptor, {
				fetch: async () => fixture.response,
				signal: controller.signal,
			}),
			fixture.pattern,
			fixture.label,
		);
	}
});

test('actual bytes reject cumulative overrun and final truncation and cancel the reader', async () => {
	const overrun = sequenceReader([Uint8Array.of(1, 2, 3)]);
	await assert.rejects(
		() => materializeDesktopReadBlob(
			{ url: 'soundscaper-app://bundle/read-overrun', size: 2 },
			{ fetch: async () => overrun.response(2), signal: new AbortController().signal },
		),
		/actual bytes.*declared size|declared size.*actual bytes/iu,
	);
	assert.equal(overrun.cancelReasons.length, 1);

	const truncated = sequenceReader([Uint8Array.of(1, 2)]);
	await assert.rejects(
		() => materializeDesktopReadBlob(
			{ url: 'soundscaper-app://bundle/read-truncated', size: 3 },
			{ fetch: async () => truncated.response(3), signal: new AbortController().signal },
		),
		/actual bytes.*declared size|declared size.*actual bytes/iu,
	);
	assert.equal(truncated.cancelReasons.length, 1);
});

test('retained parts are copied and split at the platform media chunk limit', async () => {
	const maximumChunkBytes = PLATFORM_TRANSFER_HARD_LIMITS.mediaChunkBytes;
	const backing = new Uint8Array(maximumChunkBytes + 11);
	backing.fill(7);
	const source = backing.subarray(4, maximumChunkBytes + 7);
	const stream = sequenceReader([source]);
	const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Blob');
	const OriginalBlob = globalThis.Blob;
	const observedParts: BlobPart[][] = [];
	class InspectingBlob extends OriginalBlob {
		constructor(parts: BlobPart[] = [], options?: BlobPropertyBag) {
			observedParts.push([...parts]);
			super(parts, options);
		}
	}
	Object.defineProperty(globalThis, 'Blob', {
		configurable: true,
		writable: true,
		value: InspectingBlob,
	});
	try {
		const blob = await materializeDesktopReadBlob(
			{ url: 'soundscaper-app://bundle/read-split', size: source.byteLength },
			{ fetch: async () => stream.response(source.byteLength), signal: new AbortController().signal },
		);
		assert.equal(blob.size, source.byteLength);
	} finally {
		if (originalDescriptor) Object.defineProperty(globalThis, 'Blob', originalDescriptor);
		else Reflect.deleteProperty(globalThis, 'Blob');
	}

	assert.equal(observedParts.length, 1);
	const parts = observedParts[0] ?? [];
	assert.deepEqual(parts.map((part) => (part as Uint8Array).byteLength), [maximumChunkBytes, 3]);
	for (const part of parts) {
		assert.ok(part instanceof Uint8Array);
		assert.notEqual(part.buffer, backing.buffer);
	}
});

test('a final Blob size mismatch is rejected after exact stream accounting', async () => {
	const stream = sequenceReader([Uint8Array.of(1, 2)]);
	const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Blob');
	const OriginalBlob = globalThis.Blob;
	class WrongSizeBlob extends OriginalBlob {
		override get size(): number {
			return super.size + 1;
		}
	}
	Object.defineProperty(globalThis, 'Blob', {
		configurable: true,
		writable: true,
		value: WrongSizeBlob,
	});
	try {
		await assert.rejects(
			() => materializeDesktopReadBlob(
				{ url: 'soundscaper-app://bundle/read-blob-check', size: 2 },
				{ fetch: async () => stream.response(2), signal: new AbortController().signal },
			),
			/Blob.*declared size|declared size.*Blob/iu,
		);
	} finally {
		if (originalDescriptor) Object.defineProperty(globalThis, 'Blob', originalDescriptor);
		else Reflect.deleteProperty(globalThis, 'Blob');
	}
});

test('abort promptly cancels a stalled reader and preserves the exact abort reason', async () => {
	const controller = new AbortController();
	const reason = new DOMException('renderer read cancelled', 'AbortError');
	let readStarted: (() => void) | undefined;
	const started = new Promise<void>((resolvePromise) => { readStarted = resolvePromise; });
	const cancelReasons: unknown[] = [];
	const reader = {
		read(): Promise<ReadableStreamReadResult<Uint8Array>> {
			readStarted?.();
			return new Promise(() => undefined);
		},
		cancel(cancelReason?: unknown): Promise<void> {
			cancelReasons.push(cancelReason);
			return new Promise(() => undefined);
		},
	};
	const response = readerResponse(reader, 1);
	const operation = materializeDesktopReadBlob(
		{ url: 'soundscaper-app://bundle/read-stalled', size: 1 },
		{ fetch: async () => response, signal: controller.signal },
	);
	await started;
	controller.abort(reason);
	const timeout = Symbol('timeout');
	const outcome = await Promise.race([
		operation.then(
			() => ({ kind: 'fulfilled' as const }),
			(error: unknown) => ({ kind: 'rejected' as const, error }),
		),
		delay(250, timeout, { ref: false }),
	]);

	assert.notEqual(outcome, timeout, 'abort must not await a stalled read or cancellation');
	assert.equal(typeof outcome, 'object');
	if (typeof outcome !== 'object') return;
	assert.equal(outcome.kind, 'rejected');
	if (outcome.kind !== 'rejected') return;
	assert.equal(outcome.error, reason);
	assert.deepEqual(cancelReasons, [reason]);
});

function sequenceReader(chunks: readonly Uint8Array[]): Readonly<{
	response(contentLength: number): DesktopReadResponse;
	cancelReasons: unknown[];
}> {
	let index = 0;
	const cancelReasons: unknown[] = [];
	const reader = {
		async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
			const value = chunks[index];
			index += 1;
			return value
				? { done: false, value }
				: { done: true, value: undefined };
		},
		async cancel(reason?: unknown): Promise<void> {
			cancelReasons.push(reason);
		},
	};
	return Object.freeze({
		response: (contentLength: number) => readerResponse(reader, contentLength),
		cancelReasons,
	});
}

function readerResponse(
	reader: Readonly<{
		read(): Promise<ReadableStreamReadResult<Uint8Array>>;
		cancel(reason?: unknown): Promise<void>;
	}>,
	contentLength: number,
): DesktopReadResponse {
	return {
		ok: true,
		status: 200,
		headers: new Headers({ 'Content-Length': String(contentLength) }),
		body: {
			getReader: () => reader,
		} as unknown as ReadableStream<Uint8Array>,
	};
}
