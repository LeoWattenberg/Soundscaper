/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createVideoTimingAssetPublication,
	normalizeVideoTimingAssetReference,
	validateVideoTimingAssetBytes,
	VIDEO_TIMING_ASSET_MIME_TYPE,
	type VideoTimingAssetInput,
	type VideoTimingAssetReference,
	type VideoTimingIndex,
} from './video-timing-asset.ts';
import { canonicalMediaContentBlob } from './storage/media-content-digest.ts';
import type {
	OwnedMediaAssetPublication,
	OwnedMediaAssetWriter,
} from './storage/media-asset-write-contract.ts';

export interface VideoTimingMediaStore {
	getMediaAssetMetadata(storageKey: string): PromiseLike<Readonly<Record<string, unknown>> | null>;
	writeMediaAsset?(
		storageKey: string,
		input: Blob,
		metadata?: Readonly<Record<string, unknown>>,
		options?: Readonly<{ signal?: AbortSignal }>,
	): PromiseLike<Readonly<Record<string, unknown>>>;
	beginMediaAssetWrite(
		storageKey: string,
		metadata: Readonly<Record<string, unknown>>,
		options: Readonly<{
			expectedBytes: number;
			expectedSha256: string;
			signal?: AbortSignal;
		}>,
	): PromiseLike<OwnedMediaAssetWriter>;
	loadMediaAsset(storageKey: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<Blob | null>;
}

export async function publishVideoTimingAsset(
	store: VideoTimingMediaStore,
	sourceSha256: string,
	input: VideoTimingAssetInput,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<Readonly<{
	reference: Readonly<VideoTimingAssetReference>;
	created: boolean;
	publication: OwnedMediaAssetPublication | null;
}>> {
	const publication = createVideoTimingAssetPublication(sourceSha256, input);
	const { reference, bytes } = publication;
	const existing = await store.getMediaAssetMetadata(reference.storageKey);
	if (existing) {
		if (existing.sha256 !== reference.sha256 || existing.size !== reference.byteLength) {
			throw new Error('An immutable timing asset key is occupied by different content.');
		}
		const loaded = await loadVideoTimingAsset(store, reference, {
			signal: options.signal,
			sourceSha256,
		});
		if (loaded.status !== 'available') {
			throw new Error(`The immutable stored timing asset is ${loaded.status}.`);
		}
		return Object.freeze({ reference, created: false, publication: null });
	}
	validateVideoTimingAssetBytes(reference, bytes);
	const writer = await store.beginMediaAssetWrite(
		reference.storageKey,
		{
			name: `${reference.sha256}.scti`,
			mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
			kind: 'video-timing',
		},
		{
			expectedBytes: reference.byteLength,
			expectedSha256: reference.sha256,
			signal: options.signal,
		},
	);
	let ownedPublication: OwnedMediaAssetPublication | null = null;
	try {
		const chunkBytes = timingWriterChunkBytes(writer.maximumChunkBytes);
		for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
			throwIfTimingAborted(options.signal);
			await writer.write(bytes.subarray(offset, Math.min(offset + chunkBytes, bytes.byteLength)), options);
		}
		if (writer.bytesWritten !== reference.byteLength) {
			throw new Error('Published timing asset emitted an unexpected byte length.');
		}
		ownedPublication = await writer.commitOwned(options);
		throwIfTimingAborted(options.signal);
		if (ownedPublication.metadata.sha256 !== reference.sha256
			|| ownedPublication.metadata.size !== reference.byteLength) {
			throw new Error('Published timing asset metadata disagrees with its canonical reference.');
		}
	} catch (error) {
		try {
			if (ownedPublication) await ownedPublication.discardIfCurrent();
			else await writer.abort();
		} catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Timing asset publication and cleanup both failed.',
				{ cause: error },
			);
		}
		throw error;
	}
	if (!ownedPublication) throw new Error('The timing asset publication did not return an ownership capability.');
	return Object.freeze({ reference, created: true, publication: ownedPublication });
}

export async function loadVideoTimingAsset(
	store: Pick<VideoTimingMediaStore, 'loadMediaAsset'>,
	value: unknown,
	options: Readonly<{ signal?: AbortSignal; sourceSha256?: string }> = {},
): Promise<Readonly<{
	status: 'available' | 'missing' | 'corrupt' | 'source-mismatch';
	index: VideoTimingIndex | null;
}>> {
	let reference: Readonly<VideoTimingAssetReference>;
	try { reference = normalizeVideoTimingAssetReference(value); } catch {
		return Object.freeze({ status: 'corrupt', index: null });
	}
	if (options.sourceSha256 !== undefined && options.sourceSha256 !== reference.sourceSha256) {
		return Object.freeze({ status: 'source-mismatch', index: null });
	}
	const blob = await store.loadMediaAsset(reference.storageKey, options);
	if (!blob) return Object.freeze({ status: 'missing', index: null });
	try {
		const canonicalBlob = canonicalMediaContentBlob(blob);
		if (canonicalBlob.size !== reference.byteLength) throw new Error('length');
		const bytes = new Uint8Array(await canonicalBlob.arrayBuffer());
		const index = validateVideoTimingAssetBytes(reference, bytes);
		return Object.freeze({ status: 'available', index });
	} catch {
		return Object.freeze({ status: 'corrupt', index: null });
	}
}

function timingWriterChunkBytes(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError('The timing media writer has an invalid chunk bound.');
	}
	return Number(value);
}

function throwIfTimingAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Timing asset publication was cancelled.', 'AbortError');
}
