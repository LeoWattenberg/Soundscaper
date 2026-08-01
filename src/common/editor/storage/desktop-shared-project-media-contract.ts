/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BlobLike, StorageRecord } from './media-records.ts';
import type {
	MediaAssetWriteOptions,
	OwnedMediaAssetWriter,
} from './media-asset-write-contract.ts';
import type { AudioSourceWriter } from './source-write-repository.ts';

export const DESKTOP_SHARED_AUDIO_ENCODING = 'audio-f32le-chunks-v1' as const;
export const DESKTOP_SHARED_VIDEO_ENCODING = 'video-original-v1' as const;
export const MAXIMUM_DESKTOP_SHARED_SOURCE_CHUNK_BYTES = 4 * 1024 * 1024;

interface DesktopSharedManagedSourceDescriptorBase {
	readonly bindingId: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly sourceId: string;
	readonly storageKey: string;
}

export type DesktopSharedManagedAudioSourceDescriptor = DesktopSharedManagedSourceDescriptorBase & Readonly<{
	readonly encoding: typeof DESKTOP_SHARED_AUDIO_ENCODING;
	readonly kind: 'audio';
}>;

export type DesktopSharedManagedVideoSourceDescriptor = DesktopSharedManagedSourceDescriptorBase & Readonly<{
	readonly encoding: typeof DESKTOP_SHARED_VIDEO_ENCODING;
	readonly kind: 'video';
}>;

export type DesktopSharedManagedSourceDescriptor =
	| DesktopSharedManagedAudioSourceDescriptor
	| DesktopSharedManagedVideoSourceDescriptor;

export interface DesktopSharedSourceTransferBridge {
	beginSharedSourceWrite(declaration: Readonly<{
		byteLength: number;
		encoding: typeof DESKTOP_SHARED_AUDIO_ENCODING | typeof DESKTOP_SHARED_VIDEO_ENCODING;
		projectId: string;
		projectRevision: number;
		sha256: string;
		sourceId: string;
	}>): Promise<Readonly<{
		status: 'present';
		source: DesktopSharedManagedSourceDescriptor;
	}> | Readonly<{
		status: 'ready';
		chunkSize: number;
		writeId: string;
	}>>;
	writeSharedSourceChunk(value: Readonly<{
		bytes: Uint8Array;
		offset: number;
		writeId: string;
	}>): Promise<Readonly<{ nextOffset: number }>>;
	finishSharedSourceWrite(value: Readonly<{
		sha256: string;
		writeId: string;
	}>): Promise<DesktopSharedManagedSourceDescriptor>;
	abortSharedSourceWrite(writeId: string): Promise<boolean>;
	readSharedSourceChunk(value: Readonly<{
		bindingId: string;
		length: number;
		offset: number;
	}>): Promise<Uint8Array>;
}

export interface DesktopSharedSourceTransferStore {
	getSourceMetadata(sourceId: string): PromiseLike<unknown> | unknown;
	getMediaAssetMetadata(sourceId: string): PromiseLike<unknown> | unknown;
	loadMediaAsset(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal; backfillDigest?: boolean }>,
	): PromiseLike<BlobLike | null> | BlobLike | null;
	beginMediaAssetWrite(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
		options: MediaAssetWriteOptions,
	): Promise<OwnedMediaAssetWriter>;
	readSourceChunks(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal; migrateLegacyPcmOnAccess?: boolean }>,
	): AsyncIterable<readonly Float32Array[] | Readonly<{ channels?: readonly Float32Array[] }>>;
	beginSourceWrite(sourceId: string, metadata?: Record<string, unknown>): Promise<AudioSourceWriter>;
	discardSourceIfCurrent(source: StorageRecord): PromiseLike<boolean> | boolean;
}

export interface DesktopSharedMediaAcquisition {
	readonly trustedSourceIds: ReadonlySet<string>;
	commit(): void;
	rollback(): Promise<void>;
}

export type DesktopSharedAudioAcquisition = DesktopSharedMediaAcquisition;
