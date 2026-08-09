/* SPDX-License-Identifier: AGPL-3.0-only */

import { throwIfScapeAborted } from '../scape-abort.ts';
import { VIDEO_TIMING_ASSET_MIME_TYPE } from '../video-timing-asset.ts';
import {
	MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES,
	type DesktopSharedManagedVideoSourceDescriptor,
	type DesktopSharedManagedVideoTimingDescriptor,
	type DesktopSharedSourceTransferBridge,
	type DesktopSharedSourceTransferStore,
} from './desktop-shared-project-media-contract.ts';
import type {
	ManagedTimingAsset,
	ManagedVideoSource,
} from './desktop-shared-project-media-sources.ts';
import type { OwnedMediaAssetPublication } from './media-asset-write-contract.ts';

const DIGEST = /^[a-f0-9]{64}$/u;

type RetainedSource = ManagedVideoSource | ManagedTimingAsset;
type RetainedDescriptor =
	| DesktopSharedManagedVideoSourceDescriptor
	| DesktopSharedManagedVideoTimingDescriptor;

export function recipientManagedMediaMetadata(
	source: RetainedSource,
	value: unknown,
): Readonly<{ size: number; sha256: string }> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Recipient-local ${label(source)} metadata is missing.`);
	}
	const record = value as Record<PropertyKey, unknown>;
	const sourceId = ownDataValue(record, 'sourceId');
	const mimeType = ownDataValue(record, 'mimeType');
	const size = ownDataValue(record, 'size');
	const sha256 = ownDataValue(record, 'sha256');
	if (sourceId !== source.storageKey || mimeType !== sourceMimeType(source)) {
		throw new Error(`Recipient-local ${label(source)} metadata does not match its project binding.`);
	}
	if (!Number.isSafeInteger(size) || Number(size) < 1) {
		throw new RangeError(`Recipient-local ${label(source)} metadata.size is invalid.`);
	}
	if (typeof sha256 !== 'string' || !DIGEST.test(sha256)) {
		throw new TypeError(`Recipient-local ${label(source)} has an invalid SHA-256.`);
	}
	if (source.kind === 'video-timing'
		&& (size !== source.byteLength || sha256 !== source.sha256)) {
		throw new Error('Recipient-local video timing asset does not match its immutable reference.');
	}
	return Object.freeze({ size: Number(size), sha256 });
}

export async function acquireManagedMediaAsset(
	source: RetainedSource,
	descriptor: RetainedDescriptor,
	bridge: Pick<DesktopSharedSourceTransferBridge, 'readSharedSourceChunk'>,
	store: Pick<DesktopSharedSourceTransferStore, 'beginMediaAssetWrite'>,
	signal?: AbortSignal,
): Promise<OwnedMediaAssetPublication> {
	const writer = await store.beginMediaAssetWrite(
		source.storageKey,
		{ name: sourceName(source), mimeType: sourceMimeType(source) },
		{ expectedBytes: descriptor.byteLength, expectedSha256: descriptor.sha256, signal },
	);
	let publication: OwnedMediaAssetPublication | null = null;
	try {
		const chunkSize = writerChunkSize(writer.maximumChunkBytes);
		let offset = 0;
		while (offset < descriptor.byteLength) {
			throwIfScapeAborted(signal);
			const length = Math.min(chunkSize, descriptor.byteLength - offset);
			const bytes = await bridge.readSharedSourceChunk({
				bindingId: descriptor.bindingId,
				length,
				offset,
			});
			if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) {
				throw new Error('Desktop shared-source read returned an unexpected chunk.');
			}
			await writer.write(bytes, { signal });
			offset += bytes.byteLength;
		}
		if (offset !== descriptor.byteLength || writer.bytesWritten !== descriptor.byteLength) {
			throw new Error(`Managed ${label(source)} emitted an unexpected byte length.`);
		}
		publication = await writer.commitOwned({ signal });
		assertPublication(publication, source, descriptor);
		return publication;
	} catch (error) {
		try {
			if (publication) await publication.discardIfCurrent();
			else await writer.abort();
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], 'Managed retained-media write and cleanup failed.');
		}
		throw error;
	}
}

function assertPublication(
	publication: OwnedMediaAssetPublication,
	source: RetainedSource,
	descriptor: RetainedDescriptor,
): void {
	if (!publication || typeof publication !== 'object'
		|| typeof publication.discardIfCurrent !== 'function'
		|| !publication.metadata || typeof publication.metadata !== 'object') {
		throw new TypeError(`Managed ${label(source)} publication is invalid.`);
	}
	const metadata = publication.metadata;
	if (metadata.sourceId !== source.storageKey
		|| metadata.size !== descriptor.byteLength
		|| metadata.sha256 !== descriptor.sha256
		|| metadata.mimeType !== sourceMimeType(source)) {
		throw new Error(`Managed ${label(source)} publication does not match its descriptor.`);
	}
}

function sourceName(source: RetainedSource): string {
	return source.kind === 'video' ? source.name : `${source.sha256}.scti`;
}

function sourceMimeType(source: RetainedSource): string {
	return source.kind === 'video' ? source.mimeType : VIDEO_TIMING_ASSET_MIME_TYPE;
}

function label(source: RetainedSource): string {
	return source.kind === 'video' ? `video source ${source.id}` : `video timing asset ${source.storageKey}`;
}

function ownDataValue(record: Record<PropertyKey, unknown>, key: PropertyKey): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor || !('value' in descriptor)) {
		throw new TypeError(`Recipient-local metadata.${String(key)} must be a data property.`);
	}
	return descriptor.value;
}

function writerChunkSize(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError('Managed retained-media writer chunk size is invalid.');
	}
	return Math.min(Number(value), MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES);
}
