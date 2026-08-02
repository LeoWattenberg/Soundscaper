/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FFMPEG_OUTPUT_STREAM_MAXIMUM_CHUNK_BYTES,
	streamFfmpegOutputFile,
	type FfmpegOutputFileSource,
	type FfmpegOutputSink,
} from '../src/common/editor/ffmpeg-output-stream.ts';

const MEBIBYTE = 1024 * 1024;

class TestSink<Output = string> implements FfmpegOutputSink<Output> {
	readonly events: string[] = [];
	abortCount = 0;
	openCount = 0;
	writeCount = 0;
	closeCount = 0;

	constructor(readonly output: Output = 'sealed' as Output) {}

	async open(exactByteLength: number): Promise<void> {
		this.openCount += 1;
		this.events.push(`open:${exactByteLength}`);
	}

	async write(chunk: Uint8Array): Promise<void> {
		this.writeCount += 1;
		this.events.push(`write:${chunk.byteLength}`);
	}

	async close(): Promise<Output> {
		this.closeCount += 1;
		this.events.push('close');
		return this.output;
	}

	async abort(reason?: unknown): Promise<void> {
		this.abortCount += 1;
		this.events.push(`abort:${errorMessage(reason)}`);
	}
}

test('FFmpeg output streaming handles a virtual 257 MiB file in bounded exact ranges', async () => {
	const byteLength = (257 * MEBIBYTE) + 17;
	const fullChunk = new Uint8Array(MEBIBYTE);
	const ranges: Array<readonly [number, number]> = [];
	let statCount = 0;
	let activeReads = 0;
	let maximumActiveReads = 0;
	const source: FfmpegOutputFileSource = {
		async statFile(path): Promise<{ size: number }> {
			assert.equal(path, 'large.mp3');
			statCount += 1;
			return { size: byteLength };
		},
		async readFileRange(path, offset, maximumBytes): Promise<Uint8Array> {
			assert.equal(path, 'large.mp3');
			ranges.push([offset, maximumBytes]);
			activeReads += 1;
			maximumActiveReads = Math.max(maximumActiveReads, activeReads);
			try {
				return maximumBytes === MEBIBYTE ? fullChunk : fullChunk.subarray(0, maximumBytes);
			} finally {
				activeReads -= 1;
			}
		},
	};
	const output = Object.freeze({ prepared: true });
	const sink = new TestSink(output);
	let emittedByteLength = 0;
	let maximumWriteBytes = 0;
	sink.write = async (chunk): Promise<void> => {
		sink.writeCount += 1;
		emittedByteLength += chunk.byteLength;
		maximumWriteBytes = Math.max(maximumWriteBytes, chunk.byteLength);
	};

	const result = await streamFfmpegOutputFile(source, 'large.mp3', sink);

	assert.equal(result.output, output);
	assert.equal(result.byteLength, byteLength);
	assert.equal(result.chunkCount, 258);
	assert.equal(statCount, 1);
	assert.equal(ranges.length, 258);
	assert.equal(emittedByteLength, byteLength);
	assert.equal(maximumWriteBytes, FFMPEG_OUTPUT_STREAM_MAXIMUM_CHUNK_BYTES);
	assert.equal(maximumActiveReads, 1);
	for (let index = 0; index < ranges.length; index += 1) {
		assert.deepEqual(ranges[index], [index * MEBIBYTE, index === 257 ? 17 : MEBIBYTE]);
	}
	assert.deepEqual(sink.events, [`open:${byteLength}`, 'close']);
	assert.equal(sink.abortCount, 0);
});

test('FFmpeg output streaming opens empty output at its exact size and closes without a read', async () => {
	let readCount = 0;
	const sink = new TestSink();
	const result = await streamFfmpegOutputFile({
		async statFile(): Promise<{ size: number }> { return { size: 0 }; },
		async readFileRange(): Promise<Uint8Array> {
			readCount += 1;
			return new Uint8Array(0);
		},
	}, 'empty.mp3', sink);
	assert.deepEqual(result, { output: 'sealed', byteLength: 0, chunkCount: 0 });
	assert.equal(readCount, 0);
	assert.deepEqual(sink.events, ['open:0', 'close']);
});

test('FFmpeg output streaming awaits sink backpressure before requesting another range', async () => {
	const firstWrite = deferred<void>();
	let readCount = 0;
	let activeWrites = 0;
	let maximumActiveWrites = 0;
	const sink = new TestSink();
	sink.write = async (chunk): Promise<void> => {
		sink.writeCount += 1;
		activeWrites += 1;
		maximumActiveWrites = Math.max(maximumActiveWrites, activeWrites);
		try {
			if (sink.writeCount === 1) await firstWrite.promise;
			assert.equal(chunk.byteLength, 3);
		} finally {
			activeWrites -= 1;
		}
	};
	const streaming = streamFfmpegOutputFile({
		async statFile(): Promise<{ size: number }> { return { size: 6 }; },
		async readFileRange(_path, offset, maximumBytes): Promise<Uint8Array> {
			assert.equal(offset, readCount * 3);
			assert.equal(maximumBytes, 3);
			readCount += 1;
			return new Uint8Array(3);
		},
	}, 'backpressure.mp3', sink, { maximumChunkBytes: 3 });
	await waitFor(() => activeWrites === 1);
	assert.equal(readCount, 1);
	firstWrite.resolve();
	const result = await streaming;
	assert.equal(readCount, 2);
	assert.equal(result.chunkCount, 2);
	assert.equal(maximumActiveWrites, 1);
});

test('FFmpeg output streaming rejects invalid bounds before reading and aborts the sink once', async () => {
	for (const maximumChunkBytes of [0, -1, 1.5, MEBIBYTE + 1, Number.NaN]) {
		const sink = new TestSink();
		let statCount = 0;
		await assert.rejects(
			streamFfmpegOutputFile({
				async statFile(): Promise<{ size: number }> { statCount += 1; return { size: 1 }; },
				async readFileRange(): Promise<Uint8Array> { return Uint8Array.of(1); },
			}, 'invalid.mp3', sink, { maximumChunkBytes }),
			/positive safe integer no greater than 1048576/u,
		);
		assert.equal(statCount, 0);
		assert.equal(sink.abortCount, 1);
	}
});

test('FFmpeg output streaming validates the stat result and preserves stat failures', async () => {
	for (const invalidSize of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
		const sink = new TestSink();
		await assert.rejects(
			streamFfmpegOutputFile({
				async statFile(): Promise<{ size: number }> { return { size: invalidSize }; },
				async readFileRange(): Promise<Uint8Array> { return Uint8Array.of(1); },
			}, 'bad-stat.mp3', sink),
			/safe non-negative integer/u,
		);
		assert.equal(sink.abortCount, 1);
	}
	const primary = new Error('stat failed');
	const sink = new TestSink();
	await assert.rejects(
		streamFfmpegOutputFile({
			async statFile(): Promise<never> { throw primary; },
			async readFileRange(): Promise<Uint8Array> { return Uint8Array.of(1); },
		}, 'stat-error.mp3', sink),
		(error: unknown) => error === primary,
	);
	assert.deepEqual(sink.events, ['abort:stat failed']);
});

test('FFmpeg output streaming rejects zero, short, oversized, and non-byte ranges', async () => {
	const cases: ReadonlyArray<readonly [string, unknown, RegExp]> = [
		['no progress', new Uint8Array(0), /made no forward progress/u],
		['short read', new Uint8Array(2), /short range/u],
		['oversized read', new Uint8Array(4), /exceeded the requested length/u],
		['invalid read', 'abc', /expected Uint8Array/u],
	];
	for (const [label, returned, expected] of cases) {
		const sink = new TestSink();
		await assert.rejects(
			streamFfmpegOutputFile({
				async statFile(): Promise<{ size: number }> { return { size: 3 }; },
				async readFileRange(): Promise<Uint8Array> { return returned as Uint8Array; },
			}, `${label}.mp3`, sink),
			expected,
		);
		assert.equal(sink.writeCount, 0);
		assert.equal(sink.closeCount, 0);
		assert.equal(sink.abortCount, 1);
	}
});

test('FFmpeg output streaming aborts once for open, range, write, and close failures', async () => {
	for (const phase of ['open', 'range', 'write', 'close'] as const) {
		const primary = new Error(`${phase} failed`);
		const sink = new TestSink();
		if (phase === 'open') sink.open = async (): Promise<void> => { throw primary; };
		if (phase === 'write') sink.write = async (): Promise<void> => { throw primary; };
		if (phase === 'close') sink.close = async (): Promise<string> => {
			sink.closeCount += 1;
			throw primary;
		};
		await assert.rejects(
			streamFfmpegOutputFile({
				async statFile(): Promise<{ size: number }> { return { size: 1 }; },
				async readFileRange(): Promise<Uint8Array> {
					if (phase === 'range') throw primary;
					return Uint8Array.of(1);
				},
			}, `${phase}.mp3`, sink),
			(error: unknown) => error === primary,
		);
		assert.equal(sink.abortCount, 1, phase);
		assert.equal(sink.closeCount, phase === 'close' ? 1 : 0);
	}
});

test('FFmpeg output streaming observes preflight and mid-stream cancellation', async () => {
	const preflight = new AbortController();
	const preflightReason = new Error('preflight cancelled');
	preflight.abort(preflightReason);
	const preflightSink = new TestSink();
	let statCount = 0;
	await assert.rejects(
		streamFfmpegOutputFile({
			async statFile(): Promise<{ size: number }> { statCount += 1; return { size: 1 }; },
			async readFileRange(): Promise<Uint8Array> { return Uint8Array.of(1); },
		}, 'preflight.mp3', preflightSink, { signal: preflight.signal }),
		(error: unknown) => error === preflightReason,
	);
	assert.equal(statCount, 0);
	assert.equal(preflightSink.abortCount, 1);

	const midstream = new AbortController();
	const midstreamReason = new Error('midstream cancelled');
	const midstreamSink = new TestSink();
	await assert.rejects(
		streamFfmpegOutputFile({
			async statFile(): Promise<{ size: number }> { return { size: 2 }; },
			async readFileRange(): Promise<Uint8Array> {
				midstream.abort(midstreamReason);
				return Uint8Array.of(1, 2);
			},
		}, 'midstream.mp3', midstreamSink, { signal: midstream.signal }),
		(error: unknown) => error === midstreamReason,
	);
	assert.equal(midstreamSink.writeCount, 0);
	assert.equal(midstreamSink.abortCount, 1);
});

test('FFmpeg output streaming checks currentness around external operations', async () => {
	const stale = new Error('project changed');
	let isStale = false;
	const sink = new TestSink();
	await assert.rejects(
		streamFfmpegOutputFile({
			async statFile(): Promise<{ size: number }> { return { size: 1 }; },
			async readFileRange(): Promise<Uint8Array> {
				isStale = true;
				return Uint8Array.of(1);
			},
		}, 'stale.mp3', sink, {
			assertCurrent(): void { if (isStale) throw stale; },
		}),
		(error: unknown) => error === stale,
	);
	assert.equal(sink.writeCount, 0);
	assert.equal(sink.abortCount, 1);
});

test('FFmpeg output streaming reports the primary and sink cleanup failures together', async () => {
	const primary = new Error('write failed');
	const cleanup = new Error('abort failed');
	const sink = new TestSink();
	sink.write = async (): Promise<void> => { throw primary; };
	sink.abort = async (): Promise<void> => { sink.abortCount += 1; throw cleanup; };
	let caught: unknown;
	try {
		await streamFfmpegOutputFile({
			async statFile(): Promise<{ size: number }> { return { size: 1 }; },
			async readFileRange(): Promise<Uint8Array> { return Uint8Array.of(1); },
		}, 'aggregate.mp3', sink);
	} catch (error) {
		caught = error;
	}
	assert(caught instanceof AggregateError);
	assert.deepEqual(caught.errors, [primary, cleanup]);
	assert.equal(sink.abortCount, 1);
});

function deferred<T>(): {
	readonly promise: Promise<T>;
	resolve(value: T | PromiseLike<T>): void;
} {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve; });
	return { promise, resolve };
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = performance.now() + 5_000;
	while (performance.now() < deadline) {
		if (predicate()) return;
		await new Promise<void>((resolve) => { setImmediate(resolve); });
	}
	throw new Error('Timed out waiting for FFmpeg output stream fixture.');
}
