/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { unzipSync } from 'fflate';

import {
	createSequentialZip32Archive,
	type SequentialZip32Sink,
} from '../src/common/editor/controller/sequential-zip32-stream.ts';
import {
	EMPTY_ZIP32_LAYOUT,
	extendZip32Layout,
} from '../src/common/editor/controller/zip32.ts';

class MemorySink implements SequentialZip32Sink<Uint8Array> {
	readonly chunks: Uint8Array[] = [];
	abortCount = 0;
	closeCount = 0;

	async write(chunk: Uint8Array): Promise<void> {
		this.chunks.push(Uint8Array.from(chunk));
	}

	async close(): Promise<Uint8Array> {
		this.closeCount += 1;
		return concatenate(this.chunks);
	}

	async abort(): Promise<void> {
		this.abortCount += 1;
	}
}

test('sequential ZIP32 streams preserve entry order and report their exact layout', async () => {
	const sink = new MemorySink();
	const archive = await createSequentialZip32Archive(sink);
	const source = Uint8Array.of(7, 8, 9, 10);
	await archive.add('blob.raw', new Blob([Uint8Array.of(1, 2, 3)]));
	await archive.add('bytes.raw', Uint8Array.of(4));
	await archive.add('view.raw', new DataView(source.buffer, 1, 2));
	await archive.add('buffer.raw', Uint8Array.of(11, 12).buffer);

	const first = await archive.finish();
	const second = await archive.finish();
	assert.equal(second, first);
	assert.equal(first.output.byteLength, first.byteLength);
	assert.equal(first.byteLength, first.layout.archiveByteLength);
	assert.deepEqual(first.layout, [
		{ fileName: 'blob.raw', byteLength: 3 },
		{ fileName: 'bytes.raw', byteLength: 1 },
		{ fileName: 'view.raw', byteLength: 2 },
		{ fileName: 'buffer.raw', byteLength: 2 },
	].reduce(extendZip32Layout, EMPTY_ZIP32_LAYOUT));
	const entries = unzipSync(first.output);
	assert.deepEqual(Object.keys(entries), ['blob.raw', 'bytes.raw', 'view.raw', 'buffer.raw']);
	assert.deepEqual(Array.from(entries['blob.raw']!), [1, 2, 3]);
	assert.deepEqual(Array.from(entries['bytes.raw']!), [4]);
	assert.deepEqual(Array.from(entries['view.raw']!), [8, 9]);
	assert.deepEqual(Array.from(entries['buffer.raw']!), [11, 12]);
	assert.equal(sink.closeCount, 1);
	await assert.rejects(() => archive.add('late.raw', Uint8Array.of(1)), /ZIP32 stream is closed/u);
	await archive.abort();
	assert.equal(sink.abortCount, 0);
});

test('sequential ZIP32 streams apply sink backpressure and reject overlapping additions', async () => {
	const firstWrite = deferred<void>();
	let blockFirstWrite = true;
	let activeWrites = 0;
	let maximumActiveWrites = 0;
	const sink = new MemorySink();
	const originalWrite = sink.write.bind(sink);
	sink.write = async (chunk: Uint8Array): Promise<void> => {
		activeWrites += 1;
		maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
		try {
			if (blockFirstWrite) {
				blockFirstWrite = false;
				await firstWrite.promise;
			}
			await originalWrite(chunk);
		} finally {
			activeWrites -= 1;
		}
	};
	let readCount = 0;
	const input = customBlob(2, {
		async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
			readCount += 1;
			if (readCount === 1) return { done: false, value: Uint8Array.of(1) };
			if (readCount === 2) return { done: false, value: Uint8Array.of(2) };
			return { done: true, value: undefined };
		},
		async cancel(): Promise<void> {},
		releaseLock(): void {},
	});
	const archive = await createSequentialZip32Archive(sink);
	const firstAdd = archive.add('first.raw', input);
	await waitFor(() => activeWrites === 1);
	assert.equal(readCount, 1);
	await assert.rejects(
		() => archive.add('overlap.raw', Uint8Array.of(3)),
		/ZIP32 entries must be added one at a time/u,
	);
	assert.equal(readCount, 1);
	firstWrite.resolve();
	await firstAdd;
	await archive.add('second.raw', Uint8Array.of(3));
	const result = await archive.finish();
	assert.equal(maximumActiveWrites, 1);
	assert.deepEqual(Object.keys(unzipSync(result.output)), ['first.raw', 'second.raw']);
});

test('sequential ZIP32 streams slice byte inputs and await each sink write', async () => {
	const firstWrite = deferred<void>();
	let writeStarted = false;
	const sink = new MemorySink();
	const originalWrite = sink.write.bind(sink);
	sink.write = async (chunk: Uint8Array): Promise<void> => {
		if (!writeStarted) {
			writeStarted = true;
			await firstWrite.promise;
		}
		await originalWrite(chunk);
	};
	const input = new Uint8Array(256 * 1024);
	let sliceCount = 0;
	const originalSubarray = input.subarray.bind(input);
	Object.defineProperty(input, 'subarray', {
		configurable: true,
		value: (begin: number, end?: number) => {
			sliceCount += 1;
			return originalSubarray(begin, end);
		},
	});
	const archive = await createSequentialZip32Archive(sink);
	const addition = archive.add('bounded.raw', input);
	await waitFor(() => writeStarted);
	assert.equal(sliceCount, 1);
	firstWrite.resolve();
	await addition;
	assert.equal(sliceCount > 1, true);
	const result = await archive.finish();
	assert.equal(unzipSync(result.output)['bounded.raw']?.byteLength, input.byteLength);
});

test('sequential ZIP32 streams cancel a pending Blob read and abort the sink', async () => {
	let readStarted = false;
	let cancelled = false;
	let released = false;
	const input = customBlob(1, {
		read(): Promise<ReadableStreamReadResult<Uint8Array>> {
			readStarted = true;
			return new Promise(() => undefined);
		},
		async cancel(): Promise<void> { cancelled = true; },
		releaseLock(): void { released = true; },
	});
	const sink = new MemorySink();
	const archive = await createSequentialZip32Archive(sink);
	const abort = new AbortController();
	const addition = archive.add('pending.raw', input, abort.signal);
	await waitFor(() => readStarted);
	abort.abort();
	await assert.rejects(addition, { name: 'AbortError' });
	assert.equal(cancelled, true);
	assert.equal(released, true);
	assert.equal(sink.abortCount, 1);
	await assert.rejects(() => archive.finish(), { name: 'AbortError' });
	await archive.abort();
	assert.equal(sink.abortCount, 1);
});

test('sequential ZIP32 finalization rejects output whose emitted length differs from its layout', async () => {
	const input = new Blob([Uint8Array.of(1)]);
	Object.defineProperty(input, 'size', { configurable: true, value: 2 });
	const sink = new MemorySink();
	const archive = await createSequentialZip32Archive(sink);
	await archive.add('mismatch.raw', input);
	await assert.rejects(() => archive.finish(), /emitted byte length does not match its ZIP32 layout/u);
	assert.equal(sink.closeCount, 0);
	assert.equal(sink.abortCount, 1);
});

test('sequential ZIP32 write failures abort once and remain safe to abort again', async () => {
	let writeCount = 0;
	let abortCount = 0;
	const archive = await createSequentialZip32Archive({
		async write(): Promise<void> {
			writeCount += 1;
			throw new Error('write failed');
		},
		async close(): Promise<void> {},
		async abort(): Promise<void> { abortCount += 1; },
	});
	await assert.rejects(() => archive.add('partial.raw', Uint8Array.of(1, 2)), /write failed/u);
	assert.equal(writeCount, 1);
	assert.equal(abortCount, 1);
	await archive.abort();
	await archive.abort();
	assert.equal(abortCount, 1);
	await assert.rejects(() => archive.finish(), /write failed/u);
});

test('sequential ZIP32 finalization reports close and cleanup failures without retrying either', async () => {
	let closeCount = 0;
	let abortCount = 0;
	const archive = await createSequentialZip32Archive({
		async write(): Promise<void> {},
		async close(): Promise<never> {
			closeCount += 1;
			throw new Error('close failed');
		},
		async abort(): Promise<void> {
			abortCount += 1;
			throw new Error('abort failed');
		},
	});
	await archive.add('entry.raw', Uint8Array.of(1));
	let firstError: unknown;
	try {
		await archive.finish();
	} catch (error) {
		firstError = error;
	}
	assert(firstError instanceof AggregateError);
	assert.deepEqual(firstError.errors.map(String), ['Error: close failed', 'Error: abort failed']);
	await assert.rejects(
		() => archive.finish(),
		(error: unknown) => error === firstError,
	);
	assert.equal(closeCount, 1);
	assert.equal(abortCount, 1);
});

test('aborting ZIP32 finalization aborts promptly and never publishes the sink', async () => {
	const finalWrite = deferred<void>();
	let blockWrites = false;
	let blockedWriteStarted = false;
	let closeCount = 0;
	let abortCount = 0;
	const sink = new MemorySink();
	const originalWrite = sink.write.bind(sink);
	sink.write = async (chunk: Uint8Array): Promise<void> => {
		if (blockWrites) {
			blockedWriteStarted = true;
			await finalWrite.promise;
		}
		await originalWrite(chunk);
	};
	sink.close = async (): Promise<Uint8Array> => {
		closeCount += 1;
		return concatenate(sink.chunks);
	};
	sink.abort = async (): Promise<void> => { abortCount += 1; };
	const archive = await createSequentialZip32Archive(sink);
	await archive.add('entry.raw', Uint8Array.of(1));
	blockWrites = true;
	const finishing = archive.finish();
	await waitFor(() => blockedWriteStarted);
	await archive.abort();
	assert.equal(abortCount, 1);
	assert.equal(closeCount, 0);
	finalWrite.resolve();
	await assert.rejects(finishing, /ZIP32 stream is closed/u);
	assert.equal(closeCount, 0);
});

test('sequential ZIP32 abort is idempotent and surfaces a sink abort failure', async () => {
	let abortCount = 0;
	const archive = await createSequentialZip32Archive({
		async write(): Promise<void> {},
		async close(): Promise<void> {},
		async abort(): Promise<void> {
			abortCount += 1;
			throw new Error('abort failed');
		},
	});
	let firstError: unknown;
	try {
		await archive.abort();
	} catch (error) {
		firstError = error;
	}
	assert.match(String(firstError), /abort failed/u);
	await assert.rejects(
		() => archive.abort(),
		(error: unknown) => error === firstError,
	);
	assert.equal(abortCount, 1);
	await assert.rejects(() => archive.finish(), /ZIP32 stream is closed/u);
});

function customBlob(
	byteLength: number,
	reader: Pick<ReadableStreamDefaultReader<Uint8Array>, 'read' | 'cancel' | 'releaseLock'>,
): Blob {
	const blob = new Blob();
	Object.defineProperty(blob, 'size', { configurable: true, value: byteLength });
	Object.defineProperty(blob, 'stream', {
		configurable: true,
		value: () => ({ getReader: () => reader }),
	});
	return blob;
}

function deferred<Value>(): {
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
} {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve };
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise<void>((resolve) => { setImmediate(resolve); });
	}
	throw new Error('Timed out waiting for asynchronous test state.');
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}
