/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createSequentialSevenZipCopyArchive,
	SEVEN_ZIP_COPY_PREFIX_BYTE_LENGTH,
	sevenZipCopyArchiveByteLength,
	type SequentialSevenZipCopySink,
} from '../src/common/editor/controller/sequential-seven-zip-copy.ts';
import { SEVEN_ZIP_COPY_GOLDEN_BASE64 } from './fixtures/seven-zip-copy-golden.ts';

const entries = Object.freeze([
	Object.freeze({ fileName: 'lead.wav', expectedByteLength: 3 }),
	Object.freeze({ fileName: 'Bäs.wav', expectedByteLength: 2 }),
]);

class MemorySink implements SequentialSevenZipCopySink<Uint8Array> {
	readonly chunks: Uint8Array[] = [];
	abortCount = 0;
	finalizeCount = 0;

	async write(chunk: Uint8Array): Promise<void> {
		this.chunks.push(Uint8Array.from(chunk));
	}

	async finalize(finalPrefix: Uint8Array): Promise<Uint8Array> {
		this.finalizeCount += 1;
		const bytes = concatenate(this.chunks);
		bytes.set(finalPrefix, 0);
		return bytes;
	}

	async abort(): Promise<void> {
		this.abortCount += 1;
	}
}

test('sequential 7z Copy emits a placeholder, ordered data, a next header, and one final prefix', async () => {
	const sink = new MemorySink();
	const archive = await createSequentialSevenZipCopyArchive(entries, sink);
	assert.equal(sink.chunks.length, 1);
	assert.deepEqual(sink.chunks[0], new Uint8Array(SEVEN_ZIP_COPY_PREFIX_BYTE_LENGTH));
	await archive.add('lead.wav', new Blob([Uint8Array.of(1, 2, 3)]));
	await archive.add('Bäs.wav', new DataView(Uint8Array.of(4, 5).buffer));

	const first = await archive.finish();
	const second = await archive.finish();
	assert.equal(second, first);
	assert.equal(first.byteLength, sevenZipCopyArchiveByteLength(entries));
	assert.equal(first.output.byteLength, first.byteLength);
	assert.deepEqual(first.output, new Uint8Array(Buffer.from(SEVEN_ZIP_COPY_GOLDEN_BASE64, 'base64')));
	assert.equal(sink.finalizeCount, 1);
	await archive.abort();
	assert.equal(sink.abortCount, 0);
});

test('sequential 7z Copy validates exact positive plans before sink I/O', async () => {
	for (const invalid of [
		[],
		[{ fileName: '', expectedByteLength: 1 }],
		[{ fileName: '../escape.wav', expectedByteLength: 1 }],
		[{ fileName: 'empty.wav', expectedByteLength: 0 }],
		[{ fileName: 'unsafe.wav', expectedByteLength: Number.MAX_SAFE_INTEGER + 1 }],
		[
			{ fileName: 'same.wav', expectedByteLength: 1 },
			{ fileName: 'same.wav', expectedByteLength: 2 },
		],
	] as const) {
		const sink = new MemorySink();
		await assert.rejects(createSequentialSevenZipCopyArchive(invalid, sink));
		assert.equal(sink.chunks.length, 0);
		assert.equal(sink.abortCount, 0);
	}
});

test('pre-write entry name and declared-size errors are recoverable', async () => {
	const sink = new MemorySink();
	const archive = await createSequentialSevenZipCopyArchive([
		{ fileName: 'first.raw', expectedByteLength: 1 },
		{ fileName: 'second.raw', expectedByteLength: 1 },
	], sink);
	await assert.rejects(() => archive.add('second.raw', Uint8Array.of(1)), /Unexpected stem archive entry/u);
	await assert.rejects(() => archive.add('first.raw', Uint8Array.of(1, 2)), /size does not match its plan/u);
	assert.equal(sink.abortCount, 0);
	assert.equal(sink.chunks.length, 1);
	await archive.add('first.raw', Uint8Array.of(1));
	await archive.add('second.raw', Uint8Array.of(2));
	await archive.finish();
});

test('runtime size drift and cancellation terminate the archive and abort its sink once', async () => {
	for (const scenario of ['drift', 'cancel'] as const) {
		const sink = new MemorySink();
		const archive = await createSequentialSevenZipCopyArchive([
			{ fileName: 'stream.raw', expectedByteLength: 2 },
		], sink);
		const controller = new AbortController();
		let cancelled = false;
		const input = customBlob(2, {
			async read(): Promise<ReadableStreamReadResult<Uint8Array>> {
				if (scenario === 'cancel') controller.abort();
				return { done: false, value: Uint8Array.of(1) };
			},
			async cancel(): Promise<void> { cancelled = true; },
			releaseLock(): void {},
		});
		await assert.rejects(
			() => archive.add('stream.raw', input, controller.signal),
			scenario === 'cancel'
				? (error: Error) => error.name === 'AbortError'
				: /stream size does not match its plan/u,
		);
		assert.equal(cancelled, true);
		assert.equal(sink.abortCount, 1);
		await archive.abort();
		assert.equal(sink.abortCount, 1);
	}
});

test('setup and finalization failures aggregate sink cleanup errors without retries', async () => {
	const setupPrimary = new Error('prefix write failed');
	const setupCleanup = new Error('setup abort failed');
	let setupAbortCount = 0;
	await assert.rejects(
		createSequentialSevenZipCopyArchive([{ fileName: 'one.raw', expectedByteLength: 1 }], {
			async write(): Promise<void> { throw setupPrimary; },
			async finalize(): Promise<void> {},
			async abort(): Promise<void> { setupAbortCount += 1; throw setupCleanup; },
		}),
		(error: unknown) => aggregateContains(error, [setupPrimary, setupCleanup]),
	);
	assert.equal(setupAbortCount, 1);

	const finalPrimary = new Error('finalize failed');
	const finalCleanup = new Error('final abort failed');
	let finalizeCount = 0;
	let finalAbortCount = 0;
	const archive = await createSequentialSevenZipCopyArchive([
		{ fileName: 'one.raw', expectedByteLength: 1 },
	], {
		async write(): Promise<void> {},
		async finalize(): Promise<never> { finalizeCount += 1; throw finalPrimary; },
		async abort(): Promise<void> { finalAbortCount += 1; throw finalCleanup; },
	});
	await archive.add('one.raw', Uint8Array.of(1));
	let firstError: unknown;
	try {
		await archive.finish();
	} catch (error) {
		firstError = error;
	}
	assert.equal(aggregateContains(firstError, [finalPrimary, finalCleanup]), true);
	await assert.rejects(() => archive.finish(), (error: unknown) => error === firstError);
	await assert.rejects(() => archive.abort(), (error: unknown) => error === finalCleanup);
	assert.equal(finalizeCount, 1);
	assert.equal(finalAbortCount, 1);
});

test('missing entries and explicit abort are terminal and abort once', async () => {
	const missingSink = new MemorySink();
	const missing = await createSequentialSevenZipCopyArchive(entries, missingSink);
	await assert.rejects(() => missing.finish(), /missing one or more planned entries/u);
	await assert.rejects(() => missing.finish(), /missing one or more planned entries/u);
	assert.equal(missingSink.abortCount, 1);

	const abortedSink = new MemorySink();
	const aborted = await createSequentialSevenZipCopyArchive(entries, abortedSink);
	await aborted.abort();
	await aborted.abort();
	assert.equal(abortedSink.abortCount, 1);
	await assert.rejects(() => aborted.finish(), /7z Copy archive is closed/u);
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

function aggregateContains(error: unknown, expected: readonly Error[]): boolean {
	return error instanceof AggregateError
		&& error.errors.length === expected.length
		&& error.errors.every((entry, index) => entry === expected[index]);
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
	const byteLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const result = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}
