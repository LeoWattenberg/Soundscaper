/* SPDX-License-Identifier: AGPL-3.0-only */

import { abortError, throwIfAborted } from './app-helpers.ts';
import { EMPTY_ZIP32_LAYOUT, extendZip32Layout, type Zip32Layout } from './zip32.ts';

export type Zip32StreamInput = Blob | Uint8Array | ArrayBuffer | ArrayBufferView;

export interface SequentialZip32Sink<Output> {
	write(chunk: Uint8Array): Promise<void>;
	close(): Promise<Output>;
	abort(): Promise<void>;
}

export interface SequentialZip32Result<Output> {
	readonly output: Output;
	readonly byteLength: number;
	readonly layout: Zip32Layout;
}

export interface SequentialZip32Archive<Output> {
	add(fileName: string, input: Zip32StreamInput, signal?: AbortSignal | null): Promise<void>;
	finish(): Promise<SequentialZip32Result<Output>>;
	abort(): Promise<void>;
}

export interface SequentialZip32Options {
	readonly closedMessage?: string;
	readonly limitMessage?: string;
	readonly concurrentAddMessage?: string;
}

const DEFAULT_CLOSED_MESSAGE = 'ZIP32 stream is closed.';
const DEFAULT_LIMIT_MESSAGE = 'ZIP32 limits exceeded.';
const DEFAULT_CONCURRENT_ADD_MESSAGE = 'ZIP32 entries must be added one at a time.';
const INPUT_CHUNK_BYTE_LENGTH = 64 * 1024;

export async function createSequentialZip32Archive<Output>(
	sink: SequentialZip32Sink<Output>,
	options: SequentialZip32Options = {},
): Promise<SequentialZip32Archive<Output>> {
	let fflate: typeof import('fflate');
	try {
		fflate = await import('fflate');
	} catch (error) {
		throw await abortAfterSetupFailure(sink, normalizeError(error));
	}

	const closedMessage = options.closedMessage ?? DEFAULT_CLOSED_MESSAGE;
	const limitMessage = options.limitMessage ?? DEFAULT_LIMIT_MESSAGE;
	const concurrentAddMessage = options.concurrentAddMessage ?? DEFAULT_CONCURRENT_ADD_MESSAGE;
	let state: 'open' | 'finishing' | 'finished' | 'failed' = 'open';
	let layout: Zip32Layout = EMPTY_ZIP32_LAYOUT;
	let emittedByteLength = 0;
	let adding = false;
	let writeQueue = Promise.resolve();
	let failure: Error | null = null;
	let failurePromise: Promise<Error> | null = null;
	let sinkAbortPromise: Promise<void> | null = null;
	let sinkAbortFailure: Error | null = null;
	let finishPromise: Promise<SequentialZip32Result<Output>> | null = null;
	let publicAbortPromise: Promise<void> | null = null;
	let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	let readerCancelPromise: Promise<void> | null = null;
	let terminated = false;
	const encoderFinished = deferred<void>();
	observeRejection(encoderFinished.promise);

	const zip = new fflate.Zip((error, chunk, final) => {
		if (error) {
			const encoderError = normalizeError(error);
			failure ??= encoderError;
			writeQueue = writeQueue.then(() => { throw encoderError; });
			observeRejection(writeQueue);
			encoderFinished.reject(encoderError);
			return;
		}
		if (chunk?.byteLength) {
			const bytes = Uint8Array.from(chunk);
			try {
				emittedByteLength = addSafeByteLengths(emittedByteLength, bytes.byteLength);
				writeQueue = writeQueue.then(() => sink.write(bytes));
			} catch (writeError) {
				writeQueue = Promise.reject(writeError);
			}
			observeRejection(writeQueue);
		}
		if (final) encoderFinished.resolve();
	});

	function terminateEncoder(): void {
		if (terminated) return;
		terminated = true;
		try {
			zip.terminate();
		} catch {
			// The encoder may already have completed or failed.
		}
	}

	function cancelActiveReader(reason: unknown): Promise<void> {
		if (!activeReader) return Promise.resolve();
		if (!readerCancelPromise) {
			readerCancelPromise = activeReader.cancel(reason);
			observeRejection(readerCancelPromise);
		}
		return readerCancelPromise;
	}

	function abortSink(): Promise<void> {
		if (sinkAbortPromise) return sinkAbortPromise;
		const pendingWrites = writeQueue;
		const pendingCancellation = cancelActiveReader(failure);
		observeRejection(pendingWrites);
		observeRejection(pendingCancellation);
		sinkAbortPromise = Promise.resolve().then(() => sink.abort()).catch((error: unknown) => {
			sinkAbortFailure = normalizeError(error);
			throw sinkAbortFailure;
		});
		observeRejection(sinkAbortPromise);
		return sinkAbortPromise;
	}

	function failArchive(error: unknown): Promise<Error> {
		if (failurePromise) return failurePromise;
		const primary = normalizeError(error);
		failure = primary;
		state = 'failed';
		terminateEncoder();
		encoderFinished.reject(primary);
		failurePromise = (async () => {
			try {
				await abortSink();
			} catch (cleanupError) {
				failure = combineErrors(primary, normalizeError(cleanupError));
			}
			return failure!;
		})();
		return failurePromise;
	}

	async function add(
		fileName: string,
		input: Zip32StreamInput,
		signal: AbortSignal | null = null,
	): Promise<void> {
		if (state !== 'open' || failure) throw failure ?? new Error(closedMessage);
		if (adding) throw new Error(concurrentAddMessage);
		throwIfAborted(signal);
		const nextLayout = extendZip32Layout(layout, {
			fileName,
			byteLength: inputByteLength(input),
		});
		if (!nextLayout.eligible) {
			throw await failArchive(new RangeError(limitMessage));
		}
		adding = true;
		layout = nextLayout;
		try {
			const entry = new fflate.ZipPassThrough(fileName);
			zip.add(entry);
			if (input instanceof Blob) await pushBlob(entry, input, signal);
			else {
				const bytes = toUint8Array(input);
				for (let offset = 0; offset < bytes.byteLength; offset += INPUT_CHUNK_BYTE_LENGTH) {
					throwIfAborted(signal);
					if (state !== 'open') throw failure ?? new Error(closedMessage);
					entry.push(bytes.subarray(offset, offset + INPUT_CHUNK_BYTE_LENGTH), false);
					await writeQueue;
				}
			}
			throwIfAborted(signal);
			if (state !== 'open') throw failure ?? new Error(closedMessage);
			entry.push(new Uint8Array(0), true);
			await writeQueue;
			throwIfAborted(signal);
			if (state !== 'open') throw failure ?? new Error(closedMessage);
		} catch (error) {
			throw await failArchive(error);
		} finally {
			adding = false;
		}
	}

	async function pushBlob(
		entry: InstanceType<typeof fflate.ZipPassThrough>,
		input: Blob,
		signal: AbortSignal | null,
	): Promise<void> {
		const reader = input.stream().getReader();
		activeReader = reader;
		readerCancelPromise = null;
		const aborted = deferred<never>();
		observeRejection(aborted.promise);
		const onAbort = (): void => { aborted.reject(abortError()); };
		if (signal) signal.addEventListener('abort', onAbort, { once: true });
		try {
			while (true) {
				throwIfAborted(signal);
				const next = signal
					? await Promise.race([reader.read(), aborted.promise])
					: await reader.read();
				throwIfAborted(signal);
				if (state !== 'open') throw failure ?? new Error(closedMessage);
				if (next.done) break;
				entry.push(next.value, false);
				await writeQueue;
			}
		} catch (error) {
			await settle(cancelActiveReader(error));
			throw error;
		} finally {
			if (signal) signal.removeEventListener('abort', onAbort);
			reader.releaseLock();
			if (activeReader === reader) {
				activeReader = null;
				readerCancelPromise = null;
			}
		}
	}

	function finish(): Promise<SequentialZip32Result<Output>> {
		if (finishPromise) return finishPromise;
		if (failure) return Promise.reject(failure);
		if (state !== 'open' || adding) return Promise.reject(new Error(closedMessage));
		state = 'finishing';
		finishPromise = (async () => {
			try {
				zip.end();
				await encoderFinished.promise;
				await writeQueue;
				if (state !== 'finishing' || failure) throw failure ?? new Error(closedMessage);
				if (emittedByteLength !== layout.archiveByteLength) {
					throw new Error('ZIP stream emitted byte length does not match its ZIP32 layout.');
				}
				const output = await sink.close();
				state = 'finished';
				return Object.freeze({ output, byteLength: emittedByteLength, layout });
			} catch (error) {
				throw await failArchive(error);
			}
		})();
		observeRejection(finishPromise);
		return finishPromise;
	}

	function abort(): Promise<void> {
		if (state === 'finished') return Promise.resolve();
		if (publicAbortPromise) return publicAbortPromise;
		publicAbortPromise = (async () => {
			await failArchive(failure ?? new Error(closedMessage));
			if (sinkAbortFailure) throw sinkAbortFailure;
		})();
		observeRejection(publicAbortPromise);
		return publicAbortPromise;
	}

	return Object.freeze({ add, finish, abort });
}

function toUint8Array(input: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
	if (input instanceof Uint8Array) return input;
	if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	return new Uint8Array(input);
}

function inputByteLength(input: Zip32StreamInput): number {
	const byteLength = input instanceof Blob ? input.size : toUint8Array(input).byteLength;
	if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
		throw new RangeError('Archive input sizes must be nonnegative safe integers.');
	}
	return byteLength;
}

function addSafeByteLengths(left: number, right: number): number {
	if (!Number.isSafeInteger(right) || right < 0 || left > Number.MAX_SAFE_INTEGER - right) {
		throw new RangeError('ZIP stream size exceeds JavaScript\'s safe-integer range.');
	}
	return left + right;
}

async function abortAfterSetupFailure<Output>(
	sink: SequentialZip32Sink<Output>,
	primary: Error,
): Promise<Error> {
	try {
		await sink.abort();
		return primary;
	} catch (cleanupError) {
		return combineErrors(primary, normalizeError(cleanupError));
	}
}

function combineErrors(primary: Error, cleanup: Error): AggregateError {
	return new AggregateError(
		[primary, cleanup],
		`${primary.message} ZIP sink cleanup also failed: ${cleanup.message}`,
	);
}

function normalizeError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

async function settle(promise: Promise<unknown>): Promise<void> {
	try {
		await promise;
	} catch {
		// The primary stream failure takes precedence over best-effort teardown.
	}
}

function observeRejection(promise: Promise<unknown>): void {
	void promise.catch(() => undefined);
}

function deferred<Value>(): {
	readonly promise: Promise<Value>;
	readonly resolve: (value: Value) => void;
	readonly reject: (reason?: unknown) => void;
} {
	let resolve!: (value: Value) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((accept, decline) => {
		resolve = accept;
		reject = decline;
	});
	return { promise, resolve, reject };
}
