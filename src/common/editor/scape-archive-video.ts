/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';

import type { ScapeArchiveEntry } from './scape-archive-envelope.ts';
import { awaitScapeOperation, throwIfScapeAborted } from './scape-abort.ts';
import type { ScapeExpandedByteBudget } from './scape-expanded-byte-budget.ts';
import {
	MEDIA_ASSET_STREAM_CHUNK_BYTES,
	type MediaAssetWriter,
} from './storage/media-asset-write-repository.ts';

export const SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES = MEDIA_ASSET_STREAM_CHUNK_BYTES;

export type ScapeVideoWriter = MediaAssetWriter;

export interface ScapeExtractedVideo {
	readonly digest: string;
	readonly size: number;
}

/** Streams one stored video entry through bounded verification into its staged sink. */
export async function extractScapeVideo(
	entry: ScapeArchiveEntry,
	writer: ScapeVideoWriter,
	signal?: AbortSignal,
	expandedByteBudget?: ScapeExpandedByteBudget,
): Promise<ScapeExtractedVideo> {
	if (typeof entry.getData !== 'function') throw new Error(`The .scape archive is missing ${entry.filename}.`);
	assertScapeVideoWriter(writer);
	throwIfScapeAborted(signal);
	const digest = sha256.create();
	let size = 0;
	const writable = new WritableStream<Uint8Array>({
		async write(chunk) {
			throwIfScapeAborted(signal);
			const bytes = toBytes(chunk);
			if (bytes.byteLength > SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES) {
				throw new RangeError('A .scape asset emission exceeds the fixed 4 MiB video chunk limit.');
			}
			expandedByteBudget?.consume(bytes.byteLength, entry.filename);
			if (bytes.byteLength > entry.uncompressedSize - size) {
				throw new Error(`${entry.filename} emitted bytes that do not match its archive metadata.`);
			}
			digest.update(bytes);
			size += bytes.byteLength;
			await writer.write(bytes, { signal });
			throwIfScapeAborted(signal);
		},
	});
	await awaitScapeOperation(entry.getData(writable, { signal, strictness: 'strict' }), signal);
	if (size !== entry.uncompressedSize) {
		throw new Error(`${entry.filename} emitted bytes that do not match its archive metadata.`);
	}
	return { digest: hex(digest.digest()), size };
}

function assertScapeVideoWriter(value: unknown): asserts value is ScapeVideoWriter {
	const writer = value as Partial<ScapeVideoWriter> | null;
	if (writer?.maximumChunkBytes !== SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES
		|| typeof writer.write !== 'function'
		|| typeof writer.commit !== 'function'
		|| typeof writer.abort !== 'function') {
		throw new TypeError('A bounded transactional media writer is required.');
	}
}

function toBytes(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	throw new TypeError('A .scape asset emitted a non-byte chunk.');
}

function hex(bytes: Uint8Array): string {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
