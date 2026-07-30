/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	configure,
	Reader,
	ZipReader,
} from '@zip.js/zip.js';

import {
	SCAPE_ARCHIVE_LIMITS,
	type ScapeArchiveEntry,
} from './scape-archive-envelope.ts';
import { aggregateScapeErrors, throwIfScapeAborted } from './scape-abort.ts';
import {
	assertScapeArchiveByteSource,
	createBlobScapeArchiveByteSource,
	readScapeArchiveByteRange,
	type ScapeArchiveByteSource,
} from './scape-archive-byte-source.ts';
import { bindScapeArchiveByteSourceLayout } from './scape-archive-layout.ts';
import { SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES } from './scape-archive-video.ts';

configure({ chunkSize: SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES });

export interface ScapeArchiveReader {
	getEntriesGenerator(options?: Readonly<{ strictness?: 'strict' }>): AsyncGenerator<ScapeArchiveEntry, boolean>;
	close(): Promise<void>;
}

export type ScapeArchiveReaderFactory = (
	input: Blob,
	signal?: AbortSignal,
) => PromiseLike<ScapeArchiveReader> | ScapeArchiveReader;

export type ScapeArchiveByteSourceReaderFactory = (
	input: ScapeArchiveByteSource,
	signal?: AbortSignal,
) => PromiseLike<ScapeArchiveReader> | ScapeArchiveReader;

export async function withScapeArchiveReader<Value>(
	input: Blob,
	signal: AbortSignal | undefined,
	action: (entries: readonly ScapeArchiveEntry[]) => Promise<Value>,
	createReader: ScapeArchiveReaderFactory = createZipArchiveReader,
): Promise<Value> {
	if (!(input instanceof Blob)) throw new TypeError('A .scape Blob is required.');
	throwIfScapeAborted(signal);
	const reader = await createReader(input, signal);
	return useScapeArchiveReader(reader, signal, action);
}

export async function withScapeArchiveByteSource<Value>(
	input: ScapeArchiveByteSource,
	signal: AbortSignal | undefined,
	action: (entries: readonly ScapeArchiveEntry[]) => Promise<Value>,
	createReader: ScapeArchiveByteSourceReaderFactory = createZipArchiveByteSourceReader,
): Promise<Value> {
	assertScapeArchiveByteSource(input);
	throwIfScapeAborted(signal);
	const reader = await createReader(input, signal);
	return useScapeArchiveReader(reader, signal, action);
}

async function useScapeArchiveReader<Value>(
	reader: ScapeArchiveReader,
	signal: AbortSignal | undefined,
	action: (entries: readonly ScapeArchiveEntry[]) => Promise<Value>,
): Promise<Value> {
	let failure: unknown;
	let failed = false;
	try {
		throwIfScapeAborted(signal);
		const entries: ScapeArchiveEntry[] = [];
		for await (const entry of reader.getEntriesGenerator({ strictness: 'strict' })) {
			throwIfScapeAborted(signal);
			entries.push(entry);
			if (entries.length > SCAPE_ARCHIVE_LIMITS.maximumEntryCount) {
				throw new RangeError('The .scape archive contains too many entries.');
			}
		}
		throwIfScapeAborted(signal);
		const result = await action(entries);
		throwIfScapeAborted(signal);
		return result;
	} catch (error) {
		failed = true;
		failure = error;
		throw error;
	} finally {
		try {
			await reader.close();
			if (!failed) throwIfScapeAborted(signal);
		} catch (closeError) {
			if (failed) throw aggregateScapeErrors(
				failure,
				[closeError],
				'The .scape operation and archive-reader cleanup both failed.',
			);
			throw closeError;
		}
	}
}

async function createZipArchiveReader(input: Blob, signal?: AbortSignal): Promise<ScapeArchiveReader> {
	return createZipArchiveByteSourceReader(createBlobScapeArchiveByteSource(input), signal);
}

async function createZipArchiveByteSourceReader(
	input: ScapeArchiveByteSource,
	signal?: AbortSignal,
): Promise<ScapeArchiveReader> {
	assertScapeArchiveByteSource(input);
	const layoutBoundInput = await bindScapeArchiveByteSourceLayout(input, signal);
	throwIfScapeAborted(signal);
	return new ZipReader(new ScapeZipByteSourceReader(layoutBoundInput, signal), {
		useWebWorkers: false,
		strictness: 'strict',
		signal,
	}) as unknown as ScapeArchiveReader;
}

class ScapeZipByteSourceReader extends Reader<ScapeArchiveByteSource> {
	readonly #signal: AbortSignal | undefined;
	readonly #source: ScapeArchiveByteSource;

	constructor(source: ScapeArchiveByteSource, signal?: AbortSignal) {
		super(source);
		this.#signal = signal;
		this.#source = source;
		this.size = source.size;
	}

	override async readUint8Array(offset: number, length: number): Promise<Uint8Array> {
		if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length)
			|| offset < 0 || length < 0 || offset > this.size) {
			throw new RangeError('The .scape ZIP reader requested an invalid byte range.');
		}
		const availableLength = Math.min(length, this.size - offset);
		return readScapeArchiveByteRange(this.#source, {
			offset,
			length: availableLength,
			...(this.#signal ? { signal: this.#signal } : {}),
		});
	}
}
