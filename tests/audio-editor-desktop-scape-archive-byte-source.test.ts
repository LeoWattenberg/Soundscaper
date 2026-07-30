/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES,
	createDesktopScapeArchiveByteSource,
} from '../src/common/editor/desktop-scape-archive-byte-source.ts';
import type {
	DesktopReadFetch,
	DesktopReadResponse,
} from '../src/common/editor/desktop-read-materialization.ts';
import { restoreNormalizedScapeAbortReason } from '../src/common/editor/scape-abort.ts';
import { readScapeArchiveByteRange } from '../src/common/editor/scape-archive-byte-source.ts';

const DESCRIPTOR = Object.freeze({
	url: 'soundscaper-app://bundle/_desktop/read/range/session.scape',
	size: 10,
});

test('desktop .scape sources issue exact bounded 206 requests without release authority', async () => {
	const calls: Array<Readonly<{ init: RequestInit; url: string }>> = [];
	const controller = new AbortController();
	const fetchRange: DesktopReadFetch = async (url, init) => {
		calls.push({ init, url });
		return exactResponse({
			body: [Uint8Array.of(2, 3), Uint8Array.of(4, 5)],
			contentRange: 'bytes 2-5/10',
			length: 4,
		});
	};
	const source = createDesktopScapeArchiveByteSource(DESCRIPTOR, { fetch: fetchRange });

	assert.deepEqual(Object.keys(source).sort(), ['maximumReadBytes', 'read', 'size']);
	assert.equal(source.maximumReadBytes, 16 * 1024 * 1024);
	assert.equal(source.maximumReadBytes, DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES);
	assert.equal(source.size, DESCRIPTOR.size);
	assert.deepEqual(
		await source.read({ offset: 2, length: 4, signal: controller.signal }),
		Uint8Array.of(2, 3, 4, 5),
	);
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.url, DESCRIPTOR.url);
	assert.equal(calls[0]?.init.method, 'GET');
	assert.equal(calls[0]?.init.cache, 'no-store');
	assert.equal(calls[0]?.init.credentials, 'omit');
	assert.equal(calls[0]?.init.signal, controller.signal);
	assert.equal(new Headers(calls[0]?.init.headers).get('Range'), 'bytes=2-5');

	let maximumFetchCalls = 0;
	const maximumSource = createDesktopScapeArchiveByteSource({
		url: DESCRIPTOR.url,
		size: DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES + 1,
	}, {
		fetch: async () => {
			maximumFetchCalls += 1;
			return exactResponse({
				body: [Uint8Array.of(1)],
				contentRange: `bytes 0-0/${DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES + 1}`,
				length: 1,
			});
		},
	});
	await assert.rejects(
		maximumSource.read({ offset: 0, length: DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES + 1 }),
		/unbounded byte range/iu,
	);
	assert.equal(maximumFetchCalls, 0);
	assert.deepEqual(await maximumSource.read({ offset: 0, length: 1 }), Uint8Array.of(1));
	assert.equal(maximumFetchCalls, 1, 'local range refusal does not poison an unused capability');
});

test('desktop .scape sources snapshot their validated descriptor and fetch authority', async () => {
	const descriptor = {
		url: 'soundscaper-app://bundle/_desktop/read/range/original.scape',
		size: 4,
	};
	let originalCalls = 0;
	let replacementCalls = 0;
	const options = {
		fetch: (async (url, init) => {
			originalCalls += 1;
			assert.equal(url, 'soundscaper-app://bundle/_desktop/read/range/original.scape');
			assert.equal(new Headers(init.headers).get('Range'), 'bytes=0-1');
			return exactResponse({
				body: [Uint8Array.of(0, 1)],
				contentRange: 'bytes 0-1/4',
				length: 2,
			});
		}) satisfies DesktopReadFetch,
	};
	const source = createDesktopScapeArchiveByteSource(descriptor, options);
	descriptor.url = 'https://mutated.invalid/redirected.scape';
	descriptor.size = 8;
	options.fetch = async () => {
		replacementCalls += 1;
		throw new Error('Mutable replacement fetch must not receive capability authority.');
	};

	assert.deepEqual(await source.read({ offset: 0, length: 2 }), Uint8Array.of(0, 1));
	assert.equal(source.size, 4);
	assert.equal(originalCalls, 1);
	assert.equal(replacementCalls, 0);
});

test('archive reads split at the desktop 16 MiB HTTP boundary', async () => {
	const total = DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES + 1;
	const ranges: string[] = [];
	const source = createDesktopScapeArchiveByteSource({
		url: DESCRIPTOR.url,
		size: total,
	}, {
		fetch: async (_url, init) => {
			const range = new Headers(init.headers).get('Range') ?? '';
			ranges.push(range);
			const first = ranges.length === 1;
			const length = first ? DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES : 1;
			const body = new Uint8Array(length);
			body.fill(first ? 7 : 9);
			return exactResponse({
				body: [body],
				contentRange: first
					? `bytes 0-${DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES - 1}/${total}`
					: `bytes ${DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES}-${DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES}/${total}`,
				length,
			});
		},
	});

	const bytes = await readScapeArchiveByteRange(source, { offset: 0, length: total });
	assert.equal(bytes.byteLength, total);
	assert.equal(bytes[0], 7);
	assert.equal(bytes[DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES - 1], 7);
	assert.equal(bytes[DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES], 9);
	assert.deepEqual(ranges, [
		`bytes=0-${DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES - 1}`,
		`bytes=${DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES}-${DESKTOP_SCAPE_RANGE_MAXIMUM_READ_BYTES}`,
	]);
});

test('desktop .scape sources cancel and terminally fence inexact responses', async (context) => {
	const scenarios: Array<Readonly<{
		body: readonly Uint8Array[] | null;
		contentLength?: string;
		contentRange?: string;
		name: string;
		status?: number;
	}>> = [
		{ name: 'status', status: 200, contentRange: 'bytes 0-1/10', contentLength: '2', body: [Uint8Array.of(1, 2)] },
		{ name: 'content range', contentRange: 'bytes 0-1/11', contentLength: '2', body: [Uint8Array.of(1, 2)] },
		{ name: 'content length', contentRange: 'bytes 0-1/10', contentLength: '3', body: [Uint8Array.of(1, 2)] },
		{ name: 'missing body', contentRange: 'bytes 0-1/10', contentLength: '2', body: null },
		{ name: 'short body', contentRange: 'bytes 0-1/10', contentLength: '2', body: [Uint8Array.of(1)] },
		{ name: 'overrun body', contentRange: 'bytes 0-1/10', contentLength: '2', body: [Uint8Array.of(1, 2, 3)] },
	];
	for (const scenario of scenarios) {
		await context.test(scenario.name, async () => {
			let fetchCalls = 0;
			const cancellations: unknown[] = [];
			const response = observedResponse({ ...scenario, cancellations });
			const source = createDesktopScapeArchiveByteSource(DESCRIPTOR, {
				fetch: async () => {
					fetchCalls += 1;
					return response;
				},
			});

			const primary = await rejectionOf(() => source.read({ offset: 0, length: 2 }));
			assert.match(String(primary), /range|length|body|status|bytes/iu);
			assert.equal(cancellations.length, scenario.body ? 1 : 0);
			if (cancellations.length) assert.equal(cancellations[0], primary);
			assert.equal(
				await rejectionOf(() => source.read({ offset: 2, length: 2 })),
				primary,
				'the first admitted transport failure permanently fences the source',
			);
			assert.equal(fetchCalls, 1);
		});
	}
});

test('desktop .scape sources preserve admitted transport failures and cleanup cannot replace them', async (context) => {
	await context.test('fetch rejection', async () => {
		const primary = new Error('desktop range fetch failed');
		let fetchCalls = 0;
		const source = createDesktopScapeArchiveByteSource(DESCRIPTOR, {
			fetch: async () => {
				fetchCalls += 1;
				throw primary;
			},
		});
		assert.equal(await rejectionOf(() => source.read({ offset: 0, length: 2 })), primary);
		assert.equal(await rejectionOf(() => source.read({ offset: 2, length: 2 })), primary);
		assert.equal(fetchCalls, 1);
	});

	await context.test('reader and cancellation rejection', async () => {
		const primary = new Error('desktop range body failed');
		const cleanup = new Error('desktop range cancellation failed');
		const cancellations: unknown[] = [];
		const reader = {
			read: () => Promise.reject(primary),
			cancel: (reason: unknown) => {
				cancellations.push(reason);
				return Promise.reject(cleanup);
			},
		} as ReadableStreamDefaultReader<Uint8Array>;
		const source = createDesktopScapeArchiveByteSource(DESCRIPTOR, {
			fetch: async () => responseWithReader(reader),
		});
		assert.equal(await rejectionOf(() => source.read({ offset: 0, length: 2 })), primary);
		assert.deepEqual(cancellations, [primary]);
		assert.equal(await rejectionOf(() => source.read({ offset: 2, length: 2 })), primary);
	});

	for (const scenario of [
		{ name: 'malformed read result', result: null },
		{ name: 'non-byte chunk', result: { done: false, value: 'not bytes' } },
	]) {
		await context.test(scenario.name, async () => {
			const cancellations: unknown[] = [];
			let reads = 0;
			const reader = {
				async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
					reads += 1;
					return scenario.result as unknown as ReadableStreamReadResult<Uint8Array>;
				},
				async cancel(reason: unknown): Promise<void> {
					cancellations.push(reason);
				},
			} as ReadableStreamDefaultReader<Uint8Array>;
			const source = createDesktopScapeArchiveByteSource(DESCRIPTOR, {
				fetch: async () => responseWithReader(reader),
			});
			const primary = await rejectionOf(() => source.read({ offset: 0, length: 2 }));
			assert.match(String(primary), /body|byte|result/iu);
			assert.deepEqual(cancellations, [primary]);
			assert.equal(await rejectionOf(() => source.read({ offset: 2, length: 2 })), primary);
			assert.equal(reads, 1);
		});
	}
});

test('desktop .scape sources serialize concurrent reads through response-body completion', async () => {
	const firstDoneGate = deferred<void>();
	const firstExactBytesRead = deferred<void>();
	const ranges: string[] = [];
	let fetchCalls = 0;
	const source = createDesktopScapeArchiveByteSource(DESCRIPTOR, {
		fetch: async (_url, init) => {
			fetchCalls += 1;
			const range = new Headers(init.headers).get('Range') ?? '';
			ranges.push(range);
			if (fetchCalls === 1) {
				let reads = 0;
				return responseWithReader({
					async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
						reads += 1;
						if (reads === 1) {
							firstExactBytesRead.resolve();
							return { done: false, value: Uint8Array.of(0, 1) };
						}
						await firstDoneGate.promise;
						return { done: true, value: undefined };
					},
					async cancel(): Promise<void> {},
				} as ReadableStreamDefaultReader<Uint8Array>);
			}
			return exactResponse({
				body: [Uint8Array.of(2, 3)],
				contentRange: 'bytes 2-3/10',
				length: 2,
			});
		},
	});

	const first = source.read({ offset: 0, length: 2 });
	await firstExactBytesRead.promise;
	const second = source.read({ offset: 2, length: 2 });
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(fetchCalls, 1, 'exact bytes do not release the queue before stream done');
	firstDoneGate.resolve();
	assert.deepEqual(await first, Uint8Array.of(0, 1));
	assert.deepEqual(await second, Uint8Array.of(2, 3));
	assert.deepEqual(ranges, ['bytes=0-1', 'bytes=2-3']);
});

test('an abort while queued does not fetch, cancel, or poison the source', async () => {
	const firstDoneGate = deferred<void>();
	const firstByteRead = deferred<void>();
	const cancellations: unknown[] = [];
	let fetchCalls = 0;
	const source = createDesktopScapeArchiveByteSource(DESCRIPTOR, {
		fetch: async () => {
			fetchCalls += 1;
			if (fetchCalls === 1) {
				let reads = 0;
				return responseWithReader({
					async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
						reads += 1;
						if (reads === 1) {
							firstByteRead.resolve();
							return { done: false, value: Uint8Array.of(0) };
						}
						await firstDoneGate.promise;
						return { done: true, value: undefined };
					},
					async cancel(reason: unknown): Promise<void> {
						cancellations.push(reason);
					},
				} as ReadableStreamDefaultReader<Uint8Array>, {
					contentRange: 'bytes 0-0/10',
					length: 1,
				});
			}
			return exactResponse({
				body: [Uint8Array.of(2)],
				contentRange: 'bytes 2-2/10',
				length: 1,
			});
		},
	});
	const active = source.read({ offset: 0, length: 1 });
	await firstByteRead.promise;
	const controller = new AbortController();
	const queued = source.read({ offset: 1, length: 1, signal: controller.signal });
	const reason = new DOMException('cancel queued desktop range', 'AbortError');

	controller.abort(reason);
	assert.equal(await rejectionWithin(queued), reason);
	assert.equal(fetchCalls, 1);
	assert.deepEqual(cancellations, []);
	firstDoneGate.resolve();
	assert.deepEqual(await active, Uint8Array.of(0));
	assert.deepEqual(await source.read({ offset: 2, length: 1 }), Uint8Array.of(2));
	assert.equal(fetchCalls, 2);
});

test('desktop .scape sources abort once and terminally fence queued and future reads', async () => {
	const readStarted = deferred<void>();
	const pendingRead = new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined);
	const cancellations: unknown[] = [];
	let fetchCalls = 0;
	const response: DesktopReadResponse = {
		ok: true,
		status: 206,
		headers: new Headers({
			'Content-Length': '1',
			'Content-Range': 'bytes 0-0/10',
		}),
		body: {
			getReader: () => ({
				read: () => {
					readStarted.resolve();
					return pendingRead;
				},
				cancel: (reason: unknown) => {
					cancellations.push(reason);
					return new Promise<void>(() => undefined);
				},
			}) as ReadableStreamDefaultReader<Uint8Array>,
		} as ReadableStream<Uint8Array>,
	};
	const controller = new AbortController();
	const source = createDesktopScapeArchiveByteSource(DESCRIPTOR, {
		fetch: async (_url, init) => {
			fetchCalls += 1;
			assert.equal(init.signal, controller.signal);
			return response;
		},
	});
	const active = source.read({ offset: 0, length: 1, signal: controller.signal });
	await readStarted.promise;
	const queued = source.read({ offset: 1, length: 1 });
	const reason = new DOMException('cancel desktop range', 'AbortError');

	controller.abort(reason);
	assert.equal(await rejectionWithin(active), reason);
	assert.equal(await rejectionWithin(queued), reason);
	await assert.rejects(
		source.read({ offset: 2, length: 1 }),
		(error: unknown) => error === reason,
	);
	assert.deepEqual(cancellations, [reason]);
	assert.equal(fetchCalls, 1);
});

test('primitive active aborts have one restorable terminal representation', async () => {
	const readStarted = deferred<void>();
	const controller = new AbortController();
	const source = createDesktopScapeArchiveByteSource(DESCRIPTOR, {
		fetch: async () => responseWithReader({
			read: () => {
				readStarted.resolve();
				return new Promise<ReadableStreamReadResult<Uint8Array>>(() => undefined);
			},
			async cancel(): Promise<void> {},
		} as ReadableStreamDefaultReader<Uint8Array>, {
			contentRange: 'bytes 0-0/10',
			length: 1,
		}),
	});
	const active = source.read({ offset: 0, length: 1, signal: controller.signal });
	await readStarted.promise;
	const primitiveReason = 'primitive desktop range cancellation';
	controller.abort(primitiveReason);

	const activeReason = await rejectionWithin(active);
	const futureReason = await rejectionOf(() => source.read({ offset: 1, length: 1 }));
	assert.ok(activeReason instanceof DOMException);
	assert.equal(activeReason.name, 'AbortError');
	assert.equal(futureReason, activeReason);
	assert.equal(restoreNormalizedScapeAbortReason(activeReason), primitiveReason);
});

function exactResponse(options: Readonly<{
	body: readonly Uint8Array[] | ReadableStream<Uint8Array>;
	contentRange: string;
	length: number;
}>): Response {
	const body = options.body instanceof ReadableStream
		? options.body
		: new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of options.body as readonly Uint8Array[]) controller.enqueue(chunk);
				controller.close();
			},
		});
	return new Response(body, {
		status: 206,
		headers: {
			'Content-Length': String(options.length),
			'Content-Range': options.contentRange,
		},
	});
}

function observedResponse(options: Readonly<{
	body: readonly Uint8Array[] | null;
	cancellations: unknown[];
	contentLength?: string;
	contentRange?: string;
	status?: number;
}>): DesktopReadResponse {
	let nextChunk = 0;
	const reader = {
		async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
			const chunk = options.body?.[nextChunk];
			nextChunk += 1;
			return chunk
				? { done: false, value: chunk }
				: { done: true, value: undefined };
		},
		async cancel(reason: unknown): Promise<void> {
			options.cancellations.push(reason);
		},
	} as ReadableStreamDefaultReader<Uint8Array>;
	const body = options.body === null ? null : {
		getReader: () => reader,
		async cancel(reason: unknown): Promise<void> {
			options.cancellations.push(reason);
		},
	} as ReadableStream<Uint8Array>;
	const status = options.status ?? 206;
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: new Headers({
			...(options.contentLength === undefined ? {} : { 'Content-Length': options.contentLength }),
			...(options.contentRange === undefined ? {} : { 'Content-Range': options.contentRange }),
		}),
		body,
	};
}

function responseWithReader(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	options: Readonly<{
		contentRange: string;
		length: number;
	}> = { contentRange: 'bytes 0-1/10', length: 2 },
): DesktopReadResponse {
	return {
		ok: true,
		status: 206,
		headers: new Headers({
			'Content-Length': String(options.length),
			'Content-Range': options.contentRange,
		}),
		body: {
			getReader: () => reader,
		} as ReadableStream<Uint8Array>,
	};
}

async function rejectionOf(operation: () => Promise<unknown>): Promise<unknown> {
	try {
		await operation();
	} catch (error) {
		return error;
	}
	throw new Error('Expected the operation to reject.');
}

async function rejectionWithin(operation: Promise<unknown>): Promise<unknown> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const outcome = await Promise.race([
			operation.then(
				() => ({ status: 'fulfilled' as const }),
				(reason: unknown) => ({ status: 'rejected' as const, reason }),
			),
			new Promise<Readonly<{ status: 'timeout' }>>((resolve) => {
				timer = setTimeout(() => resolve({ status: 'timeout' }), 1_000);
				timer.unref?.();
			}),
		]);
		assert.notEqual(outcome.status, 'timeout', 'desktop range rejection must remain prompt');
		assert.equal(outcome.status, 'rejected', 'expected the desktop range to reject');
		return outcome.reason;
	} finally {
		if (timer) clearTimeout(timer);
	}
}

function deferred<Value>(): Readonly<{
	promise: Promise<Value>;
	resolve(value: Value): void;
}> {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((resolvePromise) => { resolve = resolvePromise; });
	return { promise, resolve };
}
