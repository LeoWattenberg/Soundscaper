/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createSequentialSevenZipCopyArchive,
	sevenZipCopyArchiveByteLength,
	type SevenZipCopyEntry,
} from './sequential-seven-zip-copy.ts';
import {
	createStreamingZipArchive,
	createTemporaryFileSink,
	type StreamingStemArchive,
	type TemporaryExportCopy,
} from './temporary-export.ts';
import { inspectZip32Layout, type Zip32Layout } from './zip32.ts';

const MEMORY_ARCHIVE_LIMIT = 96 * 1024 ** 2;

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

type ExactStemArchiveEntryPlan = SevenZipCopyEntry;

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
	const expectedByteLength = sevenZipCopyArchiveByteLength(exactEntries);
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
	sevenZipCopyArchiveByteLength(entries);
	const sink = await createTemporaryFileSink(plan.fileName, copy);
	if (!sink.persistent && (plan.requiredTemporaryBytes ?? 0) > MEMORY_ARCHIVE_LIMIT) {
		await sink.abort();
		throw new Error(copy.largeStemsStorageRequired);
	}
	const archive = await createSequentialSevenZipCopyArchive(entries, {
		write: (chunk) => sink.write(chunk),
		async finalize(finalPrefix) {
			await sink.writeAt(0, finalPrefix);
			return sink.close(plan.mimeType);
		},
		abort: () => sink.abort(),
	}, {
		closedMessage: copy.stemArchiveClosed,
		concurrentAddMessage: 'Stem archive additions must be awaited in order.',
	});
	let finishPromise: Promise<{ readonly blob: Blob; readonly cleanup: () => Promise<void> }> | null = null;
	let finishedResult: { readonly blob: Blob; readonly cleanup: () => Promise<void> } | null = null;
	return {
		add: (fileName, input, signal = null) => archive.add(fileName, input, signal),
		finish() {
			if (finishedResult) return Promise.resolve(finishedResult);
			if (!finishPromise) finishPromise = archive.finish().then(async ({ output: blob, byteLength }) => {
				if (byteLength !== plan.expectedByteLength || blob.size !== plan.expectedByteLength) {
					const mismatch = new Error('Stem archive byte length does not match its plan.');
					try {
						await sink.remove();
					} catch (cleanupError) {
						throw new AggregateError(
							[mismatch, normalizeError(cleanupError)],
							`${mismatch.message} Temporary archive cleanup also failed.`,
						);
					}
					throw mismatch;
				}
				finishedResult = Object.freeze({ blob, cleanup: () => sink.remove() });
				return finishedResult;
			});
			return finishPromise;
		},
		abort: () => archive.abort(),
	};
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

function normalizeError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
