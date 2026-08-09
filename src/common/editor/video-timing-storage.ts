/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	createVideoTimingAssetPublication,
	decodeVideoTimingAsset,
	normalizeVideoTimingAssetReference,
	VIDEO_TIMING_ASSET_MIME_TYPE,
	type VideoTimingAssetInput,
	type VideoTimingAssetReference,
	type VideoTimingIndex,
} from './video-timing-asset.ts';

export interface VideoTimingMediaStore {
	getMediaAssetMetadata(storageKey: string): PromiseLike<Readonly<Record<string, unknown>> | null>;
	writeMediaAsset(
		storageKey: string,
		input: Blob,
		metadata?: Readonly<Record<string, unknown>>,
		options?: Readonly<{ signal?: AbortSignal }>,
	): PromiseLike<Readonly<Record<string, unknown>>>;
	loadMediaAsset(storageKey: string, options?: Readonly<{ signal?: AbortSignal }>): PromiseLike<Blob | null>;
}

export async function publishVideoTimingAsset(
	store: VideoTimingMediaStore,
	sourceSha256: string,
	input: VideoTimingAssetInput,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<Readonly<{ reference: Readonly<VideoTimingAssetReference>; created: boolean }>> {
	const publication = createVideoTimingAssetPublication(sourceSha256, input);
	const { reference, bytes } = publication;
	const existing = await store.getMediaAssetMetadata(reference.storageKey);
	if (existing) {
		if (existing.sha256 !== reference.sha256 || existing.size !== reference.byteLength) {
			throw new Error('An immutable timing asset key is occupied by different content.');
		}
		return Object.freeze({ reference, created: false });
	}
	const metadata = await store.writeMediaAsset(
		reference.storageKey,
		new Blob([Uint8Array.from(bytes).buffer], { type: VIDEO_TIMING_ASSET_MIME_TYPE }),
		{
			name: `${reference.sha256}.scti`,
			mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
			kind: 'video-timing',
		},
		options,
	);
	if (metadata.sha256 !== reference.sha256 || metadata.size !== reference.byteLength) {
		throw new Error('Published timing asset metadata disagrees with its canonical reference.');
	}
	return Object.freeze({ reference, created: true });
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
		const bytes = new Uint8Array(await blob.arrayBuffer());
		if (bytesToHex(sha256(bytes)) !== reference.sha256) throw new Error('digest');
		const index = decodeVideoTimingAsset(bytes);
		if (blob.size !== reference.byteLength || index.frameCount !== reference.frameCount
			|| index.timescale !== reference.timescale
			|| index.finalFrameDurationTicks.toString() !== reference.finalFrameDurationTicks) {
			throw new Error('summary');
		}
		return Object.freeze({ status: 'available', index });
	} catch {
		return Object.freeze({ status: 'corrupt', index: null });
	}
}
