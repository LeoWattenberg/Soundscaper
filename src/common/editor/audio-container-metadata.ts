/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeMediaMetadata } from './media-metadata.ts';
import { createAudioMetadataId3Tag } from './id3-metadata.js';
import { createApeFileMetadata } from './ape-file-metadata.ts';
import { writeFlacFileMetadata } from './flac-file-metadata.ts';
import { writeOggFileMetadata } from './ogg-comment-metadata.ts';
import { isFileBackedAudioExport, registerFileBackedExport } from './file-backed-audio-export.ts';

/** Package metadata only after encoder validation, keeping audio in its backing file. */
export async function embedAudioFileMetadata(blob: Blob, format: unknown, value: unknown, signal?: AbortSignal): Promise<Blob> {
	signal?.throwIfAborted();
	if (value != null && (typeof value !== 'object' || Array.isArray(value))) throw new TypeError('Export metadata must be an object.');
	const metadata = normalizeMediaMetadata(value ?? {}) as Readonly<Record<string, string>>;
	if (!Object.keys(metadata).length || format === 'aac-m4a') return blob;
	let output: Blob;
	if (format === 'mp3' || format === 'mp2') output = new Blob([Uint8Array.from(createAudioMetadataId3Tag(metadata)), blob], { type: blob.type });
	else if (format === 'wavpack') output = new Blob([blob, createApeFileMetadata(metadata)], { type: blob.type });
	else if (format === 'flac') output = await writeFlacFileMetadata(blob, metadata, signal);
	else if (format === 'opus' || format === 'ogg-vorbis') output = await writeOggFileMetadata(blob, format, metadata, signal);
	else throw new RangeError('This audio container does not have a browser metadata writer.');
	signal?.throwIfAborted();
	return isFileBackedAudioExport(blob) ? registerFileBackedExport(output) : output;
}
