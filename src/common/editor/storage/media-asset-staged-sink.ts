/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	mediaAssetChunkKey,
	MediaAssetChunkRecords,
} from './media-asset-chunk-records.ts';
import { MEDIA_ASSET_CHUNK_STORAGE_TYPE } from './media-asset-chunk-schema.ts';
import {
	MediaAssetStagingLease,
	MediaAssetStagingRepository,
} from './media-asset-staging-repository.ts';
import type { OpfsBinaryWriter, OpfsRepository } from './opfs-repository.ts';

export interface StagedMediaSink {
	readonly storage: string;
	readonly path?: string;
	readonly mediaChunkToken?: string;
	write(bytes: Uint8Array, index: number, signal?: AbortSignal): Promise<void>;
	close(signal?: AbortSignal): Promise<void>;
	abort(): Promise<void>;
}

export interface PreparedMediaAssetStaging {
	readonly sink: StagedMediaSink;
	readonly lease: MediaAssetStagingLease;
}

export async function prepareMediaAssetStaging({
	sourceId,
	expectedBytes,
	maximumMemoryBytes,
	database,
	chunks,
	staging,
	opfs,
	signal,
}: Readonly<{
	sourceId: string;
	expectedBytes: number;
	maximumMemoryBytes: number;
	database: IDBDatabase | null;
	chunks: MediaAssetChunkRecords;
	staging: MediaAssetStagingRepository;
	opfs: OpfsRepository;
	signal?: AbortSignal;
}>): Promise<PreparedMediaAssetStaging> {
	const plan = database ? await opfs.planBinaryWriter(`media-${sourceId}`, { signal }) : null;
	if (plan) {
		const lease = await staging.acquire(sourceId, { path: plan.path }, database);
		let writer: OpfsBinaryWriter | null;
		try {
			writer = await plan.open();
		} catch (error) {
			return releaseLeaseAfterFailure(lease, error);
		}
		if (writer) {
			const sink = opfsSink(writer, lease);
			try {
				await lease.checkpoint();
			} catch (error) {
				return abortStagingAfterFailure({ sink, lease }, error);
			}
			return { sink, lease };
		}
		await lease.release();
	}
	if (!database && expectedBytes > maximumMemoryBytes) {
		throw new RangeError('Streamed media exceeds the fixed 64 MiB process-memory media limit.');
	}
	const token = createMediaChunkToken(sourceId);
	const lease = await staging.acquire(sourceId, { mediaChunkToken: token }, database);
	return { sink: chunkSink(sourceId, token, chunks, database, lease), lease };
}

export async function abortPreparedMediaAssetStaging(
	prepared: PreparedMediaAssetStaging,
): Promise<void> {
	const results = await Promise.allSettled([
		prepared.sink.abort(),
		prepared.lease.release(),
	]);
	const errors = results
		.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
		.map(({ reason }) => reason);
	if (errors.length === 1) throw errors[0];
	if (errors.length > 1) throw new AggregateError(errors, 'Media staging sink and lease cleanup both failed.');
}

function chunkSink(
	sourceId: string,
	token: string,
	chunks: MediaAssetChunkRecords,
	database: IDBDatabase | null,
	lease: MediaAssetStagingLease,
): StagedMediaSink {
	return {
		storage: MEDIA_ASSET_CHUNK_STORAGE_TYPE,
		mediaChunkToken: token,
		write: async (bytes, index, signal) => {
			throwIfAborted(signal);
			await chunks.write({
				key: mediaAssetChunkKey(token, index),
				sourceId,
				mediaChunkToken: token,
				index,
				payload: new Blob([exactArrayBuffer(bytes)]),
				byteLength: bytes.byteLength,
				createdAt: Date.now(),
			}, database, lease);
			throwIfAborted(signal);
		},
		close: async (signal) => {
			throwIfAborted(signal);
			await lease.checkpoint();
			throwIfAborted(signal);
		},
		abort: () => chunks.delete(token, database),
	};
}

function opfsSink(writer: OpfsBinaryWriter, lease: MediaAssetStagingLease): StagedMediaSink {
	return {
		storage: 'opfs',
		path: writer.path,
		write: async (bytes, _index, signal) => {
			await lease.checkpoint();
			await writer.write(bytes, { signal });
			await lease.checkpoint();
		},
		close: async (signal) => {
			await lease.checkpoint();
			await writer.close({ signal });
			await lease.checkpoint();
		},
		abort: () => writer.abort(),
	};
}

async function abortStagingAfterFailure(
	prepared: PreparedMediaAssetStaging,
	primary: unknown,
): Promise<never> {
	try {
		await abortPreparedMediaAssetStaging(prepared);
	} catch (cleanupError) {
		throw new AggregateError([primary, cleanupError], 'Media staging and cleanup both failed.');
	}
	throw primary;
}

async function releaseLeaseAfterFailure(
	lease: MediaAssetStagingLease,
	primary: unknown,
): Promise<never> {
	try {
		await lease.release();
	} catch (cleanupError) {
		throw new AggregateError([primary, cleanupError], 'Media staging admission and lease cleanup both failed.');
	}
	throw primary;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	return buffer;
}

function createMediaChunkToken(sourceId: string): string {
	const random = globalThis.crypto?.randomUUID?.()
		?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
	return `media-${sourceId}-${random}`;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') throw new DOMException('Media storage was cancelled.', 'AbortError');
	const error = new Error('Media storage was cancelled.');
	error.name = 'AbortError';
	throw error;
}
