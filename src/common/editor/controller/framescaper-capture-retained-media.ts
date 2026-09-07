/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalMediaContentBlob } from '../storage/media-content-digest.ts';

/** Re-open committed media as native bytes before a capture probe consumes it. */
export async function loadRetainedCaptureVideoBody(
	store: Readonly<{ loadMediaAsset(key: string, options: Readonly<{ signal?: AbortSignal }>): PromiseLike<unknown> }>,
	storageKey: string,
	expectedBytes: number,
	signal: AbortSignal | null,
): Promise<Blob> {
	signal?.throwIfAborted();
	const stored = await store.loadMediaAsset(storageKey, signal ? { signal } : {});
	signal?.throwIfAborted();
	if (!stored) throw new Error('The retained capture media body is missing or truncated before probing.');
	const body = canonicalMediaContentBlob(stored);
	if (body.size !== expectedBytes) {
		throw new Error('The retained capture media body is missing or truncated before probing.');
	}
	return body;
}
