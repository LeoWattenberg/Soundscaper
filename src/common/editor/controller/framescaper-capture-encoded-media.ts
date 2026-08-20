/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type {
	EncodedCaptureSpoolRecord,
	EncodedCaptureSpoolRepository,
} from '../storage/encoded-capture-spool-repository.ts';

type EncodedSpoolReadPort = Pick<EncodedCaptureSpoolRepository, 'read'>;

export interface FramescaperCaptureEncodedMediaInput {
	readonly mimeType: string;
	readonly byteLength: number;
	/** Opens a fresh, exact, bounded-chunk read of the acknowledged prefix. */
	chunks(): AsyncIterable<Uint8Array>;
}

export interface FramescaperCaptureEncodedMaterial {
	readonly sha256: string;
	readonly byteLength: number;
}

export function openFramescaperCaptureEncodedMedia(
	repository: EncodedSpoolReadPort,
	spool: EncodedCaptureSpoolRecord,
	signal: AbortSignal | null,
): FramescaperCaptureEncodedMediaInput {
	return Object.freeze({
		mimeType: spool.mimeType,
		byteLength: spool.byteLength,
		chunks: () => readExactChunks(repository, spool, signal),
	});
}

export async function inspectFramescaperCaptureEncodedMedia(
	input: FramescaperCaptureEncodedMediaInput,
): Promise<FramescaperCaptureEncodedMaterial> {
	const digest = sha256.create();
	let byteLength = 0;
	for await (const bytes of input.chunks()) {
		digest.update(bytes);
		byteLength += bytes.byteLength;
		if (!Number.isSafeInteger(byteLength)) throw new RangeError('Capture video byte length is unsafe.');
	}
	if (byteLength !== input.byteLength || byteLength < 1) {
		throw new Error('Capture video publication did not consume its exact acknowledged prefix.');
	}
	return Object.freeze({ sha256: bytesToHex(digest.digest()), byteLength });
}

async function* readExactChunks(
	repository: EncodedSpoolReadPort,
	spool: EncodedCaptureSpoolRecord,
	signal: AbortSignal | null,
): AsyncIterable<Uint8Array> {
	let byteLength = 0;
	for await (const chunk of repository.read(spool)) {
		throwIfAborted(signal);
		const bytes = new Uint8Array(await chunk.payload.arrayBuffer());
		throwIfAborted(signal);
		if (bytes.byteLength !== chunk.payload.size) throw new Error('Capture video chunk was truncated.');
		byteLength += bytes.byteLength;
		if (!Number.isSafeInteger(byteLength) || byteLength > spool.byteLength) {
			throw new Error('Capture video spool exceeded its acknowledged prefix.');
		}
		yield bytes;
	}
	if (byteLength !== spool.byteLength || byteLength < 1) {
		throw new Error('Capture video publication did not consume its exact acknowledged prefix.');
	}
}

function throwIfAborted(signal: AbortSignal | null): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Capture publication was cancelled.', 'AbortError');
}
