/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Resumable, digest-verified downloads for optional assistance models.
 *
 * Downloads are never implicit: a caller invokes this for one artifact the
 * user asked for, and nothing here runs at startup or on a timer. Bytes land
 * in a deterministic partial file so an interrupted transfer resumes instead
 * of restarting, and the store re-verifies the completed file against its
 * recorded length and digest before publishing it, so a truncated or tampered
 * transfer is discarded rather than installed.
 */

import { open, rm, stat } from 'node:fs/promises';

import type { FileLocalModelStore, LocalModelArtifact } from './local-model-store.ts';

/** Refuses a body that claims more than this multiple of the recorded length. */
const MAX_OVERSHOOT_BYTES = 1024;

export interface LocalModelDownloadProgress {
	readonly completedBytes: number;
	readonly totalBytes: number;
}

export interface LocalModelDownloadRequest {
	readonly store: FileLocalModelStore;
	readonly artifact: LocalModelArtifact;
	readonly url: string;
	readonly fetchImpl?: typeof fetch;
	readonly signal?: AbortSignal;
	readonly onProgress?: (progress: LocalModelDownloadProgress) => void;
}

export interface LocalModelDownloadResult {
	readonly blobPath: string;
	readonly resumedFromBytes: number;
	readonly transferredBytes: number;
}

function assertDownloadUrl(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch (error) {
		throw new TypeError('A local model download URL must be absolute.', { cause: error });
	}
	if (url.protocol !== 'https:') {
		throw new TypeError('A local model download URL must use https.');
	}
	if (url.username !== '' || url.password !== '' || url.hash !== '') {
		throw new TypeError('A local model download URL must not carry credentials or a fragment.');
	}
	return url;
}

async function existingPartialBytes(path: string, limit: number): Promise<number> {
	try {
		const metadata = await stat(path);
		if (!metadata.isFile()) return 0;
		// A partial longer than the artifact cannot be a prefix of it.
		return metadata.size >= limit ? 0 : metadata.size;
	} catch {
		return 0;
	}
}

/**
 * Fetches one artifact into the store. Returns the published blob path, or
 * short-circuits when the store already holds the artifact.
 */
export async function downloadLocalModelArtifact(
	request: LocalModelDownloadRequest,
): Promise<LocalModelDownloadResult> {
	const { store, artifact, url, fetchImpl = fetch, signal, onProgress } = request;
	const target = assertDownloadUrl(url);

	if (await store.hasBlob(artifact.sha256)) {
		if (!await store.verifyArtifact(artifact)) {
			throw new Error('A published artifact failed its integrity check for this local model.');
		}
		return Object.freeze({
			blobPath: store.blobPath(artifact.sha256),
			resumedFromBytes: artifact.byteLength,
			transferredBytes: 0,
		});
	}

	const partialPath = await store.partialPath(artifact.sha256);
	let resumedFromBytes = await existingPartialBytes(partialPath, artifact.byteLength);

	const headers: Record<string, string> = { accept: 'application/octet-stream' };
	if (resumedFromBytes > 0) headers.range = `bytes=${resumedFromBytes}-`;

	const response = await fetchImpl(target, { headers, signal, redirect: 'follow' });
	if (resumedFromBytes > 0 && response.status === 200) {
		// The server ignored the range; restart cleanly rather than splicing.
		await rm(partialPath, { force: true });
		resumedFromBytes = 0;
	} else if (resumedFromBytes > 0 && response.status !== 206) {
		throw new Error(`A local model download failed with status ${response.status}.`);
	} else if (resumedFromBytes === 0 && response.status !== 200) {
		throw new Error(`A local model download failed with status ${response.status}.`);
	}

	const remaining = artifact.byteLength - resumedFromBytes;
	const declared = Number(response.headers?.get?.('content-length') ?? Number.NaN);
	if (Number.isFinite(declared) && declared > remaining + MAX_OVERSHOOT_BYTES) {
		throw new RangeError('A local model download declares more bytes than the artifact records.');
	}
	if (!response.body) {
		throw new Error('A local model download returned no body.');
	}

	let completedBytes = resumedFromBytes;
	let transferredBytes = 0;
	const handle = await open(partialPath, resumedFromBytes > 0 ? 'a' : 'w', 0o600);
	try {
		for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
			if (signal?.aborted) throw signal.reason ?? new Error('The local model download was cancelled.');
			completedBytes += chunk.byteLength;
			transferredBytes += chunk.byteLength;
			if (completedBytes > artifact.byteLength) {
				throw new RangeError('A local model download exceeded the recorded artifact length.');
			}
			await handle.write(chunk);
			onProgress?.(Object.freeze({ completedBytes, totalBytes: artifact.byteLength }));
		}
		await handle.sync();
	} finally {
		await handle.close().catch(() => undefined);
	}

	if (completedBytes !== artifact.byteLength) {
		// Keep the partial: a short read is the case resuming exists for.
		throw new RangeError('A local model download ended before the recorded artifact length.');
	}

	const blobPath = await store.publishBlob(partialPath, artifact);
	return Object.freeze({ blobPath, resumedFromBytes, transferredBytes });
}
