/* SPDX-License-Identifier: AGPL-3.0-only */

import { abortError, throwIfAborted } from './app-helpers.ts';

export const SEVEN_ZIP_COPY_PREFIX_BYTE_LENGTH = 32;

const SEVEN_ZIP_SIGNATURE = Uint8Array.of(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c);
const DEFAULT_CLOSED_MESSAGE = '7z Copy archive is closed.';
const DEFAULT_CONCURRENT_ADD_MESSAGE = '7z Copy entries must be added one at a time.';

export interface SevenZipCopyEntry {
	readonly fileName: string;
	readonly expectedByteLength: number;
}

export type SevenZipCopyInput = Blob | Uint8Array | ArrayBuffer | ArrayBufferView;

export interface SequentialSevenZipCopySink<Output> {
	write(chunk: Uint8Array): Promise<void>;
	finalize(finalPrefix: Uint8Array): Promise<Output>;
	abort(): Promise<void>;
}

export interface SequentialSevenZipCopyResult<Output> {
	readonly output: Output;
	readonly byteLength: number;
}

export interface SequentialSevenZipCopyArchive<Output> {
	add(fileName: string, input: SevenZipCopyInput, signal?: AbortSignal | null): Promise<void>;
	finish(): Promise<SequentialSevenZipCopyResult<Output>>;
	abort(): Promise<void>;
}

export interface SequentialSevenZipCopyOptions {
	readonly closedMessage?: string;
	readonly concurrentAddMessage?: string;
}

interface CompletedSevenZipCopyEntry extends SevenZipCopyEntry {
	readonly crc32: number;
}

export function sevenZipCopyArchiveByteLength(entries: readonly SevenZipCopyEntry[]): number {
	const exactEntries = normalizeEntries(entries);
	return measuredArchiveByteLength(exactEntries);
}

export async function createSequentialSevenZipCopyArchive<Output>(
	entries: readonly SevenZipCopyEntry[],
	sink: SequentialSevenZipCopySink<Output>,
	options: SequentialSevenZipCopyOptions = {},
): Promise<SequentialSevenZipCopyArchive<Output>> {
	const exactEntries = normalizeEntries(entries);
	const plannedByteLength = measuredArchiveByteLength(exactEntries);
	const closedMessage = options.closedMessage ?? DEFAULT_CLOSED_MESSAGE;
	const concurrentAddMessage = options.concurrentAddMessage ?? DEFAULT_CONCURRENT_ADD_MESSAGE;
	const completed: CompletedSevenZipCopyEntry[] = [];
	let state: 'open' | 'finishing' | 'finished' | 'failed' = 'open';
	let adding = false;
	let emittedByteLength = 0;
	let failure: Error | null = null;
	let failurePromise: Promise<Error> | null = null;
	let finishPromise: Promise<SequentialSevenZipCopyResult<Output>> | null = null;
	let publicAbortPromise: Promise<void> | null = null;
	let sinkAbortPromise: Promise<void> | null = null;
	let sinkAbortFailure: Error | null = null;
	let cleanupFailure: Error | null = null;
	let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
	let readerCancelPromise: Promise<void> | null = null;
	const terminated = deferred<never>();
	observeRejection(terminated.promise);

	function cancelActiveReader(reason: unknown): Promise<void> {
		if (!activeReader) return Promise.resolve();
		if (!readerCancelPromise) {
			readerCancelPromise = Promise.resolve().then(() => activeReader!.cancel(reason));
			observeRejection(readerCancelPromise);
		}
		return readerCancelPromise;
	}

	function abortSink(): Promise<void> {
		if (sinkAbortPromise) return sinkAbortPromise;
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
		terminated.reject(primary);
		const cancellation = cancelActiveReader(primary);
		const sinkAbort = abortSink();
		failurePromise = (async () => {
			const cleanupErrors: Error[] = [];
			for (const cleanup of [cancellation, sinkAbort]) {
				try {
					await cleanup;
				} catch (cleanupError) {
					cleanupErrors.push(normalizeError(cleanupError));
				}
			}
			cleanupFailure = combinedCleanupError(cleanupErrors);
			failure = cleanupErrors.length
				? new AggregateError(
					[primary, ...cleanupErrors],
					`${primary.message} 7z Copy sink cleanup also failed.`,
				)
				: primary;
			return failure;
		})();
		return failurePromise;
	}

	async function write(chunk: Uint8Array): Promise<void> {
		if (!chunk.byteLength) return;
		emittedByteLength = addSafeIntegers(emittedByteLength, chunk.byteLength);
		await sink.write(chunk);
		if (state !== 'open' && state !== 'finishing') {
			throw failure ?? new Error(closedMessage);
		}
	}

	async function streamBlob(
		blob: Blob,
		expectedByteLength: number,
		signal: AbortSignal | null,
		checksum: Crc32,
	): Promise<void> {
		const reader = blob.stream().getReader();
		activeReader = reader;
		readerCancelPromise = null;
		const aborted = deferred<never>();
		observeRejection(aborted.promise);
		const onAbort = (): void => { aborted.reject(abortError()); };
		if (signal) signal.addEventListener('abort', onAbort, { once: true });
		let writtenByteLength = 0;
		try {
			while (true) {
				throwIfAborted(signal);
				if (state !== 'open') throw failure ?? new Error(closedMessage);
				const next = await Promise.race([reader.read(), aborted.promise, terminated.promise]);
				throwIfAborted(signal);
				if (state !== 'open') throw failure ?? new Error(closedMessage);
				if (next.done) break;
				const chunk = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value);
				const nextByteLength = addSafeIntegers(writtenByteLength, chunk.byteLength);
				if (nextByteLength > expectedByteLength) {
					throw new Error('Stem archive entry stream size does not match its plan.');
				}
				checksum.update(chunk);
				writtenByteLength = nextByteLength;
				await write(chunk);
			}
			if (writtenByteLength !== expectedByteLength) {
				throw new Error('Stem archive entry stream size does not match its plan.');
			}
		} catch (error) {
			try {
				await cancelActiveReader(error);
			} catch (cleanupError) {
				throw new AggregateError(
					[normalizeError(error), normalizeError(cleanupError)],
					'7z Copy input stream and cancellation both failed.',
				);
			}
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

	async function add(
		fileName: string,
		input: SevenZipCopyInput,
		signal: AbortSignal | null = null,
	): Promise<void> {
		if (state !== 'open' || failure) throw failure ?? new Error(closedMessage);
		if (adding) throw new Error(concurrentAddMessage);
		const expected = exactEntries[completed.length];
		validateAddition(expected, fileName, input);
		adding = true;
		try {
			throwIfAborted(signal);
			const checksum = new Crc32();
			if (input instanceof Blob) {
				await streamBlob(input, expected!.expectedByteLength, signal, checksum);
			} else {
				const bytes = toUint8Array(input);
				checksum.update(bytes);
				await write(bytes);
				throwIfAborted(signal);
			}
			if (state !== 'open') throw failure ?? new Error(closedMessage);
			completed.push(Object.freeze({ ...expected!, crc32: checksum.digest() }));
		} catch (error) {
			throw await failArchive(error);
		} finally {
			adding = false;
		}
	}

	function finish(): Promise<SequentialSevenZipCopyResult<Output>> {
		if (finishPromise) return finishPromise;
		if (failure) return Promise.reject(failure);
		if (state !== 'open' || adding) return Promise.reject(new Error(closedMessage));
		state = 'finishing';
		finishPromise = (async () => {
			try {
				if (completed.length !== exactEntries.length) {
					throw new Error('Stem archive is missing one or more planned entries.');
				}
				const nextHeader = buildSevenZipNextHeader(completed);
				await write(nextHeader);
				if (state !== 'finishing' || failure) throw failure ?? new Error(closedMessage);
				if (emittedByteLength !== plannedByteLength) {
					throw new Error('7z Copy stream byte length does not match its exact plan.');
				}
				const output = await sink.finalize(buildSevenZipStartHeader(completed, nextHeader));
				if (state !== 'finishing' || failure) throw failure ?? new Error(closedMessage);
				state = 'finished';
				return Object.freeze({ output, byteLength: emittedByteLength });
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
			if (cleanupFailure) throw cleanupFailure;
		})();
		observeRejection(publicAbortPromise);
		return publicAbortPromise;
	}

	try {
		await write(new Uint8Array(SEVEN_ZIP_COPY_PREFIX_BYTE_LENGTH));
	} catch (error) {
		throw await failArchive(error);
	}
	return Object.freeze({ add, finish, abort });
}

function measuredArchiveByteLength(entries: readonly SevenZipCopyEntry[]): number {
	const dataByteLength = entries.reduce(
		(sum, entry) => addSafeIntegers(sum, entry.expectedByteLength),
		0,
	);
	const writer = new SevenZipHeaderWriter(false);
	writeSevenZipNextHeader(writer, entries);
	return addSafeIntegers(SEVEN_ZIP_COPY_PREFIX_BYTE_LENGTH, dataByteLength, writer.byteLength);
}

function buildSevenZipNextHeader(entries: readonly CompletedSevenZipCopyEntry[]): Uint8Array {
	const writer = new SevenZipHeaderWriter(true);
	writeSevenZipNextHeader(writer, entries);
	return writer.finish();
}

function writeSevenZipNextHeader(
	writer: SevenZipHeaderWriter,
	entries: readonly (SevenZipCopyEntry & { readonly crc32?: number })[],
): void {
	writer.byte(0x01);
	writer.byte(0x04);
	writer.byte(0x06);
	writer.number(0);
	writer.number(entries.length);
	writer.byte(0x09);
	for (const entry of entries) writer.number(entry.expectedByteLength);
	writer.byte(0x0a);
	writer.byte(1);
	for (const entry of entries) writer.uint32(entry.crc32 ?? 0);
	writer.byte(0x00);
	writer.byte(0x07);
	writer.byte(0x0b);
	writer.number(entries.length);
	writer.byte(0);
	for (const _entry of entries) {
		writer.number(1);
		writer.byte(1);
		writer.byte(0);
	}
	writer.byte(0x0c);
	for (const entry of entries) writer.number(entry.expectedByteLength);
	writer.byte(0x0a);
	writer.byte(1);
	for (const entry of entries) writer.uint32(entry.crc32 ?? 0);
	writer.byte(0x00);
	writer.byte(0x08);
	writer.byte(0x00);
	writer.byte(0x00);
	writer.byte(0x05);
	writer.number(entries.length);
	writer.byte(0x11);
	writer.number(entries.reduce(
		(size, entry) => addSafeIntegers(size, 2 * (entry.fileName.length + 1)),
		1,
	));
	writer.byte(0);
	for (const entry of entries) writer.utf16(entry.fileName);
	writer.byte(0x00);
	writer.byte(0x00);
}

function buildSevenZipStartHeader(
	entries: readonly SevenZipCopyEntry[],
	nextHeader: Uint8Array,
): Uint8Array {
	const packedByteLength = entries.reduce(
		(sum, entry) => addSafeIntegers(sum, entry.expectedByteLength),
		0,
	);
	const bytes = new Uint8Array(SEVEN_ZIP_COPY_PREFIX_BYTE_LENGTH);
	bytes.set(SEVEN_ZIP_SIGNATURE, 0);
	bytes[6] = 0;
	bytes[7] = 4;
	const view = new DataView(bytes.buffer);
	view.setBigUint64(12, BigInt(packedByteLength), true);
	view.setBigUint64(20, BigInt(nextHeader.byteLength), true);
	view.setUint32(28, crc32(nextHeader), true);
	view.setUint32(8, crc32(bytes.subarray(12)), true);
	return bytes;
}

class SevenZipHeaderWriter {
	readonly #bytes: number[] | null;
	#byteLength = 0;

	constructor(materialize: boolean) {
		this.#bytes = materialize ? [] : null;
	}

	get byteLength(): number {
		return this.#byteLength;
	}

	byte(value: number): void {
		this.#append(value & 0xff);
	}

	uint32(value: number): void {
		for (let shift = 0; shift < 32; shift += 8) this.#append((value >>> shift) & 0xff);
	}

	number(value: number): void {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new RangeError('7z NUMBER values must be nonnegative safe integers.');
		}
		for (const byte of encodeSevenZipNumber(BigInt(value))) this.#append(byte);
	}

	utf16(value: string): void {
		for (let index = 0; index < value.length; index += 1) {
			const codeUnit = value.charCodeAt(index);
			this.#append(codeUnit & 0xff);
			this.#append(codeUnit >>> 8);
		}
		this.#append(0);
		this.#append(0);
	}

	finish(): Uint8Array {
		if (!this.#bytes) throw new Error('Cannot materialize a measured 7z header.');
		return Uint8Array.from(this.#bytes);
	}

	#append(value: number): void {
		this.#byteLength = addSafeIntegers(this.#byteLength, 1);
		this.#bytes?.push(value);
	}
}

function encodeSevenZipNumber(value: bigint): Uint8Array {
	let firstByte = 0;
	let mask = 0x80;
	for (let additionalBytes = 0; additionalBytes < 8; additionalBytes += 1) {
		const limit = 1n << BigInt(7 * (additionalBytes + 1));
		if (value < limit) {
			firstByte |= Number(value >> BigInt(8 * additionalBytes));
			const result = new Uint8Array(additionalBytes + 1);
			result[0] = firstByte;
			for (let index = 0; index < additionalBytes; index += 1) {
				result[index + 1] = Number((value >> BigInt(8 * index)) & 0xffn);
			}
			return result;
		}
		firstByte |= mask;
		mask >>>= 1;
	}
	const result = new Uint8Array(9);
	result[0] = 0xff;
	for (let index = 0; index < 8; index += 1) {
		result[index + 1] = Number((value >> BigInt(8 * index)) & 0xffn);
	}
	return result;
}

class Crc32 {
	#value = 0xffff_ffff;

	update(bytes: Uint8Array): void {
		for (const byte of bytes) {
			this.#value = CRC32_TABLE[(this.#value ^ byte) & 0xff]! ^ (this.#value >>> 8);
		}
	}

	digest(): number {
		return (this.#value ^ 0xffff_ffff) >>> 0;
	}
}

const CRC32_TABLE = createCrc32Table();

function createCrc32Table(): Uint32Array {
	const table = new Uint32Array(256);
	for (let index = 0; index < table.length; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb8_8320 : 0);
		table[index] = value >>> 0;
	}
	return table;
}

function crc32(bytes: Uint8Array): number {
	const checksum = new Crc32();
	checksum.update(bytes);
	return checksum.digest();
}

function normalizeEntries(entries: readonly SevenZipCopyEntry[]): readonly SevenZipCopyEntry[] {
	if (!Array.isArray(entries) || !entries.length) {
		throw new TypeError('7z Copy archives require at least one planned entry.');
	}
	const names = new Set<string>();
	return Object.freeze(entries.map((entry) => {
		if (!entry?.fileName || entry.fileName === '.' || entry.fileName === '..'
			|| entry.fileName.includes('\0') || entry.fileName.includes('/') || entry.fileName.includes('\\')) {
			throw new TypeError('7z Copy entry names must be flat, nonempty, and cannot contain NUL characters.');
		}
		if (names.has(entry.fileName)) throw new TypeError(`Duplicate 7z Copy entry: ${entry.fileName}`);
		names.add(entry.fileName);
		if (!Number.isSafeInteger(entry.expectedByteLength) || entry.expectedByteLength <= 0) {
			throw new RangeError('7z Copy entry sizes must be positive safe integers.');
		}
		return Object.freeze({ fileName: entry.fileName, expectedByteLength: entry.expectedByteLength });
	}));
}

function validateAddition(
	expected: SevenZipCopyEntry | undefined,
	fileName: string,
	input: SevenZipCopyInput,
): void {
	if (!expected || fileName !== expected.fileName) {
		throw new Error(`Unexpected stem archive entry: ${fileName}`);
	}
	if (inputByteLength(input) !== expected.expectedByteLength) {
		throw new Error(`Stem archive entry size does not match its plan: ${fileName}`);
	}
}

function inputByteLength(input: SevenZipCopyInput): number {
	const byteLength = input instanceof Blob ? input.size : toUint8Array(input).byteLength;
	if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
		throw new RangeError('Archive input sizes must be nonnegative safe integers.');
	}
	return byteLength;
}

function toUint8Array(input: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
	if (input instanceof Uint8Array) return input;
	if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	return new Uint8Array(input);
}

function addSafeIntegers(...values: readonly number[]): number {
	let sum = 0;
	for (const value of values) {
		if (!Number.isSafeInteger(value) || value < 0 || sum > Number.MAX_SAFE_INTEGER - value) {
			throw new RangeError('7z Copy size exceeds JavaScript\'s safe-integer range.');
		}
		sum += value;
	}
	return sum;
}

function combinedCleanupError(errors: readonly Error[]): Error | null {
	if (!errors.length) return null;
	if (errors.length === 1) return errors[0]!;
	return new AggregateError(errors, 'Multiple 7z Copy cleanup operations failed.');
}

function normalizeError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
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
