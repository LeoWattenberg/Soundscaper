/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectV10 } from '../project-v10-validation.ts';
import { throwIfScapeAborted } from '../scape-abort.ts';
import { SCAPE_ARCHIVE_LIMITS } from '../scape-archive-envelope.ts';
import { createScapeDigest, scapeHex } from '../scape-archive-media.ts';
import { VIDEO_TIMING_ASSET_MIME_TYPE } from '../video-timing-asset.ts';
import {
	DESKTOP_SHARED_VIDEO_TIMING_ENCODING,
	MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES,
	type DesktopSharedManagedSourceDescriptor,
	type DesktopSharedManagedVideoTimingDescriptor,
	type DesktopSharedSourceTransferBridge,
	type DesktopSharedSourceTransferStore,
} from './desktop-shared-project-media-contract.ts';
import type { ManagedTimingAsset } from './desktop-shared-project-media-sources.ts';
import { canonicalMediaContentBlob, digestMediaContent } from './media-content-digest.ts';

const DIGEST = /^[a-f0-9]{64}$/u;
const TIMING_BINDING_ID = /^t[a-f0-9]{64}$/u;

type TimingStore = Required<Pick<
	DesktopSharedSourceTransferStore,
	'getMediaAssetMetadata' | 'loadMediaAsset'
>>;

interface TrustedTimingMetadata {
	readonly committedAt: string;
	readonly mimeType: typeof VIDEO_TIMING_ASSET_MIME_TYPE;
	readonly path: string | null | undefined;
	readonly sha256: string;
	readonly size: number;
	readonly sourceId: string;
	readonly storage: string;
}

export interface PreparedDesktopSharedTimingAsset {
	readonly asset: ManagedTimingAsset;
	readonly kind: 'video-timing';
	readonly metadata: TrustedTimingMetadata;
}

export async function preflightDesktopSharedTimingAsset(
	asset: ManagedTimingAsset,
	store: TimingStore,
	signal?: AbortSignal,
): Promise<PreparedDesktopSharedTimingAsset> {
	return Object.freeze({
		asset,
		kind: 'video-timing',
		metadata: await readTrustedTimingMetadata(store, asset, signal),
	});
}

export async function publishDesktopSharedTimingAsset(
	project: AudioEditorProjectV10,
	prepared: PreparedDesktopSharedTimingAsset,
	bridge: DesktopSharedSourceTransferBridge,
	store: TimingStore,
	signal?: AbortSignal,
): Promise<DesktopSharedManagedVideoTimingDescriptor> {
	const { asset, metadata } = prepared;
	await validateTimingPass(store, asset, metadata, signal);
	const admission = await bridge.beginSharedSourceWrite({
		byteLength: asset.byteLength,
		encoding: DESKTOP_SHARED_VIDEO_TIMING_ENCODING,
		projectId: project.id,
		projectRevision: project.revision,
		sha256: asset.sha256,
		sourceId: asset.id,
	});
	if (admission.status === 'present') {
		const descriptor = matchingTimingDescriptor(admission.source, asset);
		await validateTimingPass(store, asset, metadata, signal);
		return descriptor;
	}
	try {
		const chunkSize = positiveChunkSize(admission.chunkSize);
		const blob = await loadTimingBlob(store, asset, metadata, signal);
		const digest = createScapeDigest();
		let offset = 0;
		while (offset < asset.byteLength) {
			throwIfScapeAborted(signal);
			const length = Math.min(chunkSize, asset.byteLength - offset);
			const buffer = await blob.slice(offset, offset + length).arrayBuffer();
			throwIfScapeAborted(signal);
			if (buffer.byteLength !== length) {
				throw new Error(`Video timing asset ${asset.storageKey} emitted an unexpected byte length.`);
			}
			const bytes = new Uint8Array(buffer);
			digest.update(bytes);
			const result = await bridge.writeSharedSourceChunk({
				bytes,
				offset,
				writeId: admission.writeId,
			});
			if (!result || typeof result !== 'object' || result.nextOffset !== offset + bytes.byteLength) {
				throw new Error('Desktop shared-source write acknowledgement is out of sequence.');
			}
			offset = result.nextOffset;
		}
		const transferredDigest = scapeHex(digest.digest());
		if (offset !== asset.byteLength || transferredDigest !== asset.sha256) {
			throw new Error(`Video timing asset ${asset.storageKey} changed during managed handoff.`);
		}
		await assertTimingMetadataCurrent(store, asset, metadata, signal);
		return matchingTimingDescriptor(await bridge.finishSharedSourceWrite({
			sha256: transferredDigest,
			writeId: admission.writeId,
		}), asset);
	} catch (error) {
		try {
			await bridge.abortSharedSourceWrite(admission.writeId);
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Managed timing upload and cleanup failed.');
		}
		throw error;
	}
}

async function validateTimingPass(
	store: TimingStore,
	asset: ManagedTimingAsset,
	metadata: TrustedTimingMetadata,
	signal?: AbortSignal,
): Promise<void> {
	const blob = await loadTimingBlob(store, asset, metadata, signal);
	const sha256 = await digestMediaContent(blob, {
		chunkBytes: MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES,
		signal,
	});
	if (sha256 !== asset.sha256) {
		throw new Error(`Video timing asset ${asset.storageKey} failed its digest binding.`);
	}
	await assertTimingMetadataCurrent(store, asset, metadata, signal);
}

async function loadTimingBlob(
	store: Pick<TimingStore, 'loadMediaAsset'>,
	asset: ManagedTimingAsset,
	metadata: TrustedTimingMetadata,
	signal?: AbortSignal,
): Promise<Blob> {
	throwIfScapeAborted(signal);
	const value = await store.loadMediaAsset(asset.storageKey, { signal, backfillDigest: false });
	throwIfScapeAborted(signal);
	const blob = canonicalMediaContentBlob(value);
	if (blob.size !== metadata.size) {
		throw new Error(`Video timing asset ${asset.storageKey} changed during managed handoff.`);
	}
	return blob;
}

async function readTrustedTimingMetadata(
	store: Pick<TimingStore, 'getMediaAssetMetadata'>,
	asset: ManagedTimingAsset,
	signal?: AbortSignal,
): Promise<TrustedTimingMetadata> {
	throwIfScapeAborted(signal);
	const value = await store.getMediaAssetMetadata(asset.storageKey);
	throwIfScapeAborted(signal);
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Video timing asset ${asset.storageKey} has no trusted metadata.`);
	}
	const record = value as Record<string, unknown>;
	const sourceId = ownData(record, 'sourceId');
	const storage = ownData(record, 'storage');
	const path = ownData(record, 'path');
	const committedAt = ownData(record, 'committedAt');
	const mimeType = ownData(record, 'mimeType');
	const size = ownData(record, 'size');
	const sha256 = ownData(record, 'sha256');
	if (sourceId !== asset.storageKey || typeof storage !== 'string' || !storage
		|| (path !== undefined && path !== null && typeof path !== 'string')
		|| typeof committedAt !== 'string' || !canonicalInstant(committedAt)
		|| mimeType !== VIDEO_TIMING_ASSET_MIME_TYPE
		|| size !== asset.byteLength || sha256 !== asset.sha256) {
		throw new Error(`Video timing asset ${asset.storageKey} has invalid trusted metadata.`);
	}
	return Object.freeze({
		committedAt,
		mimeType,
		path: path as string | null | undefined,
		sha256,
		size,
		sourceId,
		storage,
	});
}

async function assertTimingMetadataCurrent(
	store: Pick<TimingStore, 'getMediaAssetMetadata'>,
	asset: ManagedTimingAsset,
	expected: TrustedTimingMetadata,
	signal?: AbortSignal,
): Promise<void> {
	const current = await readTrustedTimingMetadata(store, asset, signal);
	if (JSON.stringify(current) !== JSON.stringify(expected)) {
		throw new Error(`Video timing asset ${asset.storageKey} changed during managed handoff.`);
	}
}

function matchingTimingDescriptor(
	value: DesktopSharedManagedSourceDescriptor,
	asset: ManagedTimingAsset,
): DesktopSharedManagedVideoTimingDescriptor {
	if (value.kind !== 'video-timing'
		|| value.encoding !== DESKTOP_SHARED_VIDEO_TIMING_ENCODING
		|| !TIMING_BINDING_ID.test(value.bindingId)
		|| value.sourceId !== asset.id || value.storageKey !== asset.storageKey
		|| value.byteLength !== asset.byteLength || value.sha256 !== asset.sha256
		|| value.byteLength > SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes
		|| !DIGEST.test(value.sha256)) {
		throw new TypeError('Managed source descriptor does not match its video timing asset.');
	}
	return value;
}

function positiveChunkSize(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES) {
		throw new RangeError('Desktop shared-source chunk size is invalid.');
	}
	return Number(value);
}

function ownData(record: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Retained-media metadata.${key} must be an own data property.`);
	}
	return descriptor.value;
}

function canonicalInstant(value: string): boolean {
	const milliseconds = Date.parse(value);
	return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}
