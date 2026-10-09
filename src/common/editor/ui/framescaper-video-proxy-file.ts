/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAbortGuard } from '../abort-error.ts';
import { DESKTOP_READ_HARD_LIMIT_BYTES } from '../desktop-read-materialization.ts';
import { selectedRangeDescriptorForBlob } from '../desktop-selected-range-blob.ts';
import { MEDIA_CONTENT_DIGEST_CHUNK_BYTES } from '../storage/media-content-digest.ts';
import { withFramescaperSidecarFile, type FramescaperSidecarFileReader } from './framescaper-sidecar-file.ts';

const throwIfAborted = createAbortGuard('Native proxy selection was cancelled.');

/** The proxy authority retains plain native Blob bytes, rather than a leased range wrapper. */
export async function withFramescaperVideoProxyFile<Value>(
	service: FramescaperSidecarFileReader, descriptor: unknown, signal: AbortSignal | undefined,
	consume: (candidate: Blob) => PromiseLike<Value> | Value,
): Promise<Value> {
	return withFramescaperSidecarFile(service, descriptor, signal, async (body) => {
		throwIfAborted(signal);
		if (!selectedRangeDescriptorForBlob(body)) return consume(body);
		if (body.size > DESKTOP_READ_HARD_LIMIT_BYTES) {
			throw new RangeError('The desktop proxy read declared size exceeds its materialization maximum.');
		}
		const parts: Uint8Array<ArrayBuffer>[] = [];
		for (let start = 0; start < body.size; start += MEDIA_CONTENT_DIGEST_CHUNK_BYTES) {
			throwIfAborted(signal);
			const end = Math.min(body.size, start + MEDIA_CONTENT_DIGEST_CHUNK_BYTES);
			const bytes = await body.slice(start, end).arrayBuffer();
			throwIfAborted(signal);
			if (bytes.byteLength !== end - start) throw new Error('The desktop proxy read returned inexact bytes.');
			parts.push(new Uint8Array(bytes));
		}
		throwIfAborted(signal);
		return consume(new Blob(parts, { type: body.type }));
	});
}
