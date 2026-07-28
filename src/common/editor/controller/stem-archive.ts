/* SPDX-License-Identifier: AGPL-3.0-only */

import { throwIfAborted } from './app-helpers.ts';
import {
	createStreamingZipArchive,
	createTemporaryFileSink,
	type StreamingStemArchive,
	type TemporaryExportCopy,
} from './temporary-export.ts';
import { inspectZip32Layout, type Zip32Layout } from './zip32.ts';

const MEMORY_ARCHIVE_LIMIT = 96 * 1024 ** 2;
const SEVEN_ZIP_SIGNATURE = Uint8Array.of(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c);

export interface StemArchiveEntryPlan {
	readonly fileName: string;
	readonly expectedByteLength: number | null;
}

export interface StemArchivePlan {
	readonly format: 'zip' | '7z';
	readonly fileName: string;
	readonly mimeType: 'application/zip' | 'application/x-7z-compressed';
	readonly expectedByteLength: number | null;
	readonly requiredTemporaryBytes: number | null;
	readonly fallbackRequiredTemporaryBytes: number | null;
	readonly entries: readonly StemArchiveEntryPlan[];
	readonly zip32: Zip32Layout | null;
}

interface ExactStemArchiveEntryPlan extends StemArchiveEntryPlan {
	readonly expectedByteLength: number;
}

interface CompletedEntry extends ExactStemArchiveEntryPlan {
	readonly crc32: number;
}

export function createStemArchivePlan(
	baseName: string,
	entries: readonly StemArchiveEntryPlan[],
	fallbackRequiredTemporaryBytes: number | null = null,
): StemArchivePlan {
	const normalizedBaseName = normalizeBaseName(baseName);
	const normalizedEntries = normalizeEntries(entries);
	const normalizedFallback = optionalByteLength(fallbackRequiredTemporaryBytes);
	if (normalizedEntries.some((entry) => entry.expectedByteLength === null)) {
		return Object.freeze({
			format: 'zip',
			fileName: `${normalizedBaseName}.zip`,
			mimeType: 'application/zip',
			expectedByteLength: null,
			requiredTemporaryBytes: normalizedFallback,
			fallbackRequiredTemporaryBytes: normalizedFallback,
			entries: normalizedEntries,
			zip32: null,
		});
	}
	const exactEntries = normalizedEntries as readonly ExactStemArchiveEntryPlan[];
	const zip32 = inspectZip32Layout(exactEntries.map((entry) => ({
		fileName: entry.fileName,
		byteLength: entry.expectedByteLength,
	})));
	if (zip32.eligible) {
		return Object.freeze({
			format: 'zip',
			fileName: `${normalizedBaseName}.zip`,
			mimeType: 'application/zip',
			expectedByteLength: zip32.archiveByteLength,
			requiredTemporaryBytes: requiredTemporaryBytes(zip32.archiveByteLength, exactEntries),
			fallbackRequiredTemporaryBytes: normalizedFallback,
			entries: exactEntries,
			zip32,
		});
	}
	if (exactEntries.some((entry) => entry.expectedByteLength === 0)) {
		throw new RangeError('7z stem archives require every planned entry to be nonempty.');
	}
	return createSevenZipStemArchivePlan(normalizedBaseName, exactEntries, zip32);
}

export function createSevenZipStemArchivePlan(
	baseName: string,
	entries: readonly ExactStemArchiveEntryPlan[],
	zip32: Zip32Layout | null = null,
): StemArchivePlan {
	const normalizedBaseName = normalizeBaseName(baseName);
	const exactEntries = Object.freeze(normalizeEntries(entries).map((entry) => {
		const normalized = normalizeEntry(entry);
		if (normalized.expectedByteLength === null || normalized.expectedByteLength <= 0) {
			throw new RangeError('7z stem archives require every planned entry to be nonempty.');
		}
		return normalized as ExactStemArchiveEntryPlan;
	}));
	const expectedByteLength = sevenZipArchiveByteLength(exactEntries);
	return Object.freeze({
		format: '7z',
		fileName: `${normalizedBaseName}.7z`,
		mimeType: 'application/x-7z-compressed',
		expectedByteLength,
		requiredTemporaryBytes: requiredTemporaryBytes(expectedByteLength, exactEntries),
		fallbackRequiredTemporaryBytes: null,
		entries: exactEntries,
		zip32: zip32 ?? inspectZip32Layout(exactEntries.map((entry) => ({
			fileName: entry.fileName,
			byteLength: entry.expectedByteLength,
		}))),
	});
}

export async function createStreamingStemArchive(
	plan: StemArchivePlan,
	copy: TemporaryExportCopy,
): Promise<StreamingStemArchive> {
	validatePlan(plan);
	if (plan.format === 'zip') {
		const archive = await createStreamingZipArchive(
			plan.fileName,
			plan.requiredTemporaryBytes ?? plan.fallbackRequiredTemporaryBytes ?? 0,
			copy,
		);
		return enforcePlannedEntries(archive, plan, copy);
	}
	return createStreamingSevenZipArchive(plan, copy);
}

function enforcePlannedEntries(
	archive: StreamingStemArchive,
	plan: StemArchivePlan,
	copy: TemporaryExportCopy,
): StreamingStemArchive {
	let nextEntryIndex = 0;
	let closed = false;
	let adding = false;
	let failed: Error | null = null;
	let finishPromise: Promise<{ readonly blob: Blob; readonly cleanup: () => Promise<void> }> | null = null;
	return {
		async add(fileName, input, signal = null): Promise<void> {
			if (closed || failed) throw failed || new Error(copy.stemArchiveClosed);
			if (adding) throw new Error('Stem archive additions must be awaited in order.');
			const expected = plan.entries[nextEntryIndex];
			validateAddition(expected, fileName, input);
			adding = true;
			try {
				await archive.add(fileName, input, signal);
				nextEntryIndex += 1;
			} catch (error) {
				failed = error instanceof Error ? error : new Error(String(error));
				await archive.abort();
				throw error;
			} finally {
				adding = false;
			}
		},
		finish() {
			if (finishPromise) return finishPromise;
			if (failed) return Promise.reject(failed);
			if (closed || adding) return Promise.reject(new Error(copy.stemArchiveClosed));
			closed = true;
			if (nextEntryIndex !== plan.entries.length) {
				finishPromise = archive.abort().then(() => {
					throw new Error('Stem archive is missing one or more planned entries.');
				});
				return finishPromise;
			}
			finishPromise = archive.finish().then((result) => {
				if (plan.expectedByteLength !== null && result.blob.size !== plan.expectedByteLength) {
					return result.cleanup().then(() => {
						throw new Error('Stem archive byte length does not match its plan.');
					});
				}
				return result;
			});
			return finishPromise;
		},
		async abort(): Promise<void> {
			closed = true;
			await archive.abort();
		},
	};
}

async function createStreamingSevenZipArchive(
	plan: StemArchivePlan,
	copy: TemporaryExportCopy,
): Promise<StreamingStemArchive> {
	const entries = plan.entries as readonly ExactStemArchiveEntryPlan[];
	const sink = await createTemporaryFileSink(plan.fileName, copy);
	if (!sink.persistent && (plan.requiredTemporaryBytes ?? 0) > MEMORY_ARCHIVE_LIMIT) {
		await sink.abort();
		throw new Error(copy.largeStemsStorageRequired);
	}
	try {
		await sink.write(new Uint8Array(32));
	} catch (error) {
		await sink.abort();
		throw error;
	}
	const completed: CompletedEntry[] = [];
	let closed = false;
	let adding = false;
	let failed: Error | null = null;
	let finishPromise: Promise<{ readonly blob: Blob; readonly cleanup: () => Promise<void> }> | null = null;

	return {
		async add(fileName, input, signal = null): Promise<void> {
			if (closed || failed) throw failed || new Error(copy.stemArchiveClosed);
			if (adding) throw new Error('Stem archive additions must be awaited in order.');
			const expected = entries[completed.length];
			validateAddition(expected, fileName, input);
			adding = true;
			try {
				throwIfAborted(signal);
				const checksum = new Crc32();
				let writtenByteLength = 0;
				if (input instanceof Blob) {
					await streamBlob(input, signal, async (chunk) => {
						checksum.update(chunk);
						writtenByteLength = addSafeIntegers(writtenByteLength, chunk.byteLength);
						await sink.write(chunk);
					});
				} else {
					const bytes = toUint8Array(input);
					checksum.update(bytes);
					writtenByteLength = bytes.byteLength;
					await sink.write(bytes);
				}
				if (writtenByteLength !== expected!.expectedByteLength) {
					throw new Error(`Stem archive entry stream size does not match its plan: ${fileName}`);
				}
				completed.push(Object.freeze({ ...expected, crc32: checksum.digest() }));
			} catch (error) {
				failed = error instanceof Error ? error : new Error(String(error));
				closed = true;
				await sink.abort();
				throw error;
			} finally {
				adding = false;
			}
		},
		finish() {
			if (finishPromise) return finishPromise;
			if (failed) return Promise.reject(failed);
			if (closed || adding) return Promise.reject(new Error(copy.stemArchiveClosed));
			closed = true;
			finishPromise = (async () => {
				if (completed.length !== entries.length) {
					await sink.abort();
					throw new Error('Stem archive is missing one or more planned entries.');
				}
				try {
					const nextHeader = buildSevenZipNextHeader(completed);
					await sink.write(nextHeader);
					await sink.writeAt(0, buildSevenZipStartHeader(completed, nextHeader));
					const blob = await sink.close(plan.mimeType);
					if (blob.size !== plan.expectedByteLength) {
						await sink.remove();
						throw new Error('Stem archive byte length does not match its plan.');
					}
					return { blob, cleanup: () => sink.remove() };
				} catch (error) {
					failed = error instanceof Error ? error : new Error(String(error));
					await sink.abort();
					throw error;
				}
			})();
			return finishPromise;
		},
		async abort(): Promise<void> {
			closed = true;
			await sink.abort();
		},
	};
}

function sevenZipArchiveByteLength(entries: readonly ExactStemArchiveEntryPlan[]): number {
	const dataByteLength = entries.reduce(
		(sum, entry) => addSafeIntegers(sum, entry.expectedByteLength),
		0,
	);
	const writer = new SevenZipHeaderWriter(false);
	writeSevenZipNextHeader(writer, entries);
	return addSafeIntegers(32, dataByteLength, writer.byteLength);
}

function buildSevenZipNextHeader(entries: readonly CompletedEntry[]): Uint8Array {
	const writer = new SevenZipHeaderWriter(true);
	writeSevenZipNextHeader(writer, entries);
	return writer.finish();
}

function writeSevenZipNextHeader(
	writer: SevenZipHeaderWriter,
	entries: readonly (ExactStemArchiveEntryPlan & { readonly crc32?: number })[],
): void {
	writer.byte(0x01); // Header
	writer.byte(0x04); // MainStreamsInfo
	writer.byte(0x06); // PackInfo
	writer.number(0);
	writer.number(entries.length);
	writer.byte(0x09); // Size
	for (const entry of entries) writer.number(entry.expectedByteLength);
	writer.byte(0x0a); // CRC
	writer.byte(1);
	for (const entry of entries) writer.uint32(entry.crc32 ?? 0);
	writer.byte(0x00); // End PackInfo
	writer.byte(0x07); // UnpackInfo
	writer.byte(0x0b); // Folder
	writer.number(entries.length);
	writer.byte(0); // Folders are inline.
	for (const _entry of entries) {
		writer.number(1); // One coder.
		writer.byte(1); // One-byte method ID, one input and one output stream.
		writer.byte(0); // Copy method.
	}
	writer.byte(0x0c); // CodersUnpackSize
	for (const entry of entries) writer.number(entry.expectedByteLength);
	writer.byte(0x0a); // CRC
	writer.byte(1);
	for (const entry of entries) writer.uint32(entry.crc32 ?? 0);
	writer.byte(0x00); // End UnpackInfo
	writer.byte(0x08); // SubStreamsInfo
	writer.byte(0x00); // Default one substream per folder.
	writer.byte(0x00); // End MainStreamsInfo
	writer.byte(0x05); // FilesInfo
	writer.number(entries.length);
	writer.byte(0x11); // Name
	writer.number(entries.reduce(
		(size, entry) => addSafeIntegers(size, 2 * (entry.fileName.length + 1)),
		1,
	));
	writer.byte(0); // Names are inline.
	for (const entry of entries) writer.utf16(entry.fileName);
	writer.byte(0x00); // End FilesInfo
	writer.byte(0x00); // End Header
}

function buildSevenZipStartHeader(
	entries: readonly ExactStemArchiveEntryPlan[],
	nextHeader: Uint8Array,
): Uint8Array {
	const packedByteLength = entries.reduce(
		(sum, entry) => addSafeIntegers(sum, entry.expectedByteLength),
		0,
	);
	const bytes = new Uint8Array(32);
	bytes.set(SEVEN_ZIP_SIGNATURE, 0);
	bytes[6] = 0;
	bytes[7] = 4;
	const view = new DataView(bytes.buffer);
	view.setBigUint64(12, BigInt(packedByteLength), true);
	view.setBigUint64(20, BigInt(nextHeader.byteLength), true);
	view.setUint32(28, crc32(nextHeader), true);
	view.setUint32(8, crc32(bytes.subarray(12, 32)), true);
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
		const encoded = encodeSevenZipNumber(BigInt(value));
		for (const byte of encoded) this.#append(byte);
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
		for (const byte of bytes) this.#value = CRC32_TABLE[(this.#value ^ byte) & 0xff]! ^ (this.#value >>> 8);
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

async function streamBlob(
	blob: Blob,
	signal: AbortSignal | null,
	onChunk: (chunk: Uint8Array) => Promise<void>,
): Promise<void> {
	const reader = blob.stream().getReader();
	try {
		while (true) {
			throwIfAborted(signal);
			const { done, value } = await reader.read();
			throwIfAborted(signal);
			if (done) return;
			await onChunk(value instanceof Uint8Array ? value : new Uint8Array(value));
		}
	} catch (error) {
		try {
			await reader.cancel();
		} catch {
			// Cancellation is best effort after a source failure.
		}
		throw error;
	} finally {
		reader.releaseLock();
	}
}

function validatePlan(plan: StemArchivePlan): void {
	if (!plan.fileName || !Array.isArray(plan.entries)) throw new TypeError('Invalid stem archive plan.');
	if (plan.format === '7z') {
		if (plan.mimeType !== 'application/x-7z-compressed'
			|| !Number.isSafeInteger(plan.expectedByteLength)
			|| (plan.expectedByteLength ?? 0) <= 0
			|| plan.entries.some((entry) => entry.expectedByteLength === null || entry.expectedByteLength <= 0)) {
			throw new TypeError('7z stem archive plans require exact positive sizes.');
		}
	} else if (plan.format !== 'zip' || plan.mimeType !== 'application/zip'
		|| (plan.expectedByteLength !== null
			&& (!Number.isSafeInteger(plan.expectedByteLength) || plan.expectedByteLength < 0))) {
		throw new TypeError('Invalid stem archive format.');
	}
	normalizeEntries(plan.entries);
}

function validateAddition(
	expected: StemArchiveEntryPlan | undefined,
	fileName: string,
	input: Blob | Uint8Array | ArrayBuffer | ArrayBufferView,
): void {
	if (!expected || fileName !== expected.fileName) {
		throw new Error(`Unexpected stem archive entry: ${fileName}`);
	}
	const byteLength = inputByteLength(input);
	if (expected.expectedByteLength !== null && byteLength !== expected.expectedByteLength) {
		throw new Error(`Stem archive entry size does not match its plan: ${fileName}`);
	}
}

function normalizeEntry(entry: StemArchiveEntryPlan): StemArchiveEntryPlan {
	if (!entry.fileName || entry.fileName === '.' || entry.fileName === '..'
		|| entry.fileName.includes('\0') || entry.fileName.includes('/') || entry.fileName.includes('\\')) {
		throw new TypeError('Archive entry names must be flat, nonempty, and cannot contain NUL characters.');
	}
	if (entry.expectedByteLength !== null
		&& (!Number.isSafeInteger(entry.expectedByteLength) || entry.expectedByteLength < 0)) {
		throw new RangeError('Archive entry sizes must be nonnegative safe integers or null.');
	}
	return Object.freeze({ fileName: entry.fileName, expectedByteLength: entry.expectedByteLength });
}

function normalizeEntries(entries: readonly StemArchiveEntryPlan[]): readonly StemArchiveEntryPlan[] {
	const normalized = entries.map(normalizeEntry);
	const names = new Set<string>();
	for (const entry of normalized) {
		if (names.has(entry.fileName)) throw new TypeError(`Duplicate stem archive entry: ${entry.fileName}`);
		names.add(entry.fileName);
	}
	return Object.freeze(normalized);
}

function normalizeBaseName(baseName: string): string {
	if (!baseName || baseName.includes('\0') || baseName.includes('/') || baseName.includes('\\')) {
		throw new TypeError('Stem archive base names must be flat, nonempty, and cannot contain NUL characters.');
	}
	const normalized = baseName.replace(/\.(?:zip|7z)$/iu, '');
	if (!normalized) throw new TypeError('Stem archive base names must be nonempty.');
	return normalized;
}

function optionalByteLength(value: number | null): number | null {
	if (value === null) return null;
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError('Fallback archive storage estimates must be nonnegative safe integers or null.');
	}
	return value;
}

function requiredTemporaryBytes(
	archiveByteLength: number,
	entries: readonly ExactStemArchiveEntryPlan[],
): number {
	const largestEntry = entries.reduce(
		(largest, entry) => Math.max(largest, entry.expectedByteLength),
		0,
	);
	return addSafeIntegers(archiveByteLength, largestEntry);
}

function inputByteLength(input: Blob | Uint8Array | ArrayBuffer | ArrayBufferView): number {
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
			throw new RangeError('Archive size exceeds JavaScript\'s safe-integer range.');
		}
		sum += value;
	}
	return sum;
}
