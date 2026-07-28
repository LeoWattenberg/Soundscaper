/* SPDX-License-Identifier: AGPL-3.0-only */

import { BlobReader, configure, ZipReader } from '@zip.js/zip.js';

import {
	SCAPE_ARCHIVE_LIMITS,
	type ScapeArchiveEntry,
} from './scape-archive-envelope.ts';
import { aggregateScapeErrors, throwIfScapeAborted } from './scape-abort.ts';
import { validateScapeArchiveLayout } from './scape-archive-layout.ts';
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

export async function withScapeArchiveReader<Value>(
	input: Blob,
	signal: AbortSignal | undefined,
	action: (entries: readonly ScapeArchiveEntry[]) => Promise<Value>,
	createReader: ScapeArchiveReaderFactory = createZipArchiveReader,
): Promise<Value> {
	if (!(input instanceof Blob)) throw new TypeError('A .scape Blob is required.');
	throwIfScapeAborted(signal);
	const reader = await createReader(input, signal);
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
	await validateScapeArchiveLayout(input, signal);
	throwIfScapeAborted(signal);
	return new ZipReader(new BlobReader(input), {
		useWebWorkers: false,
		strictness: 'strict',
		signal,
	}) as unknown as ScapeArchiveReader;
}
