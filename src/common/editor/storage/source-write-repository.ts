/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PCM_CONTAINER_STORAGE_TYPE, PCM_CONTAINER_EXTENSION,
	PCM_ENCODING_WAVPACK_F32_V1,
	compressionStatistics,
	crc32,
	normalizePcmSampleRate,
	packPlanarFloat32,
} from '../wavpack/index.js';
import { normalizeChannels, type StorageRecord } from './media-records.ts';
import {
	MediaAssetStagingRepository,
	type MediaAssetStagingLease,
} from './media-asset-staging-repository.ts';
import { writeDerivedSource } from './derived-source-write.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { PcmRepository } from './pcm-repository.ts';
import type { SourceChunkRecord, SourceRecordRepository } from './source-record-repository.ts';
import { normalizePcmChunkFrames } from './pcm-chunk-geometry.ts';
import {
	PENDING_SOURCE_RETENTION_MS,
	cleanupFailure,
	clone,
	createId,
	positiveInteger,
} from './source-write-common.ts';

interface StoredChunk {
	readonly encoding: string | null;
	readonly payload?: ArrayBuffer;
	readonly channels?: ArrayBuffer[];
	readonly pcmCrc32: number;
	readonly uncompressedBytes: number;
	readonly storedBytes: number;
}

export interface AudioSourceWriter {
	readonly framesWritten: number;
	write(inputChannels: unknown, options?: { readonly signal?: AbortSignal }): Promise<void>;
	commit(
		extraMetadata?: Record<string, unknown>,
		options?: { readonly signal?: AbortSignal; readonly ifAbsent?: boolean },
	): Promise<StorageRecord>;
	abort(): Promise<void>;
}

export interface OwnedAudioSourceWriter extends AudioSourceWriter {
	readonly stageReceipt: AudioSourceStageReceipt;
}

export interface AudioSourceStageReceipt {
	readonly version: 1;
	readonly sourceId: string;
	readonly sourceToken: string;
}

interface AudioBufferLike {
	readonly numberOfChannels: number;
	readonly length: number;
	readonly sampleRate: number;
	getChannelData(channel: number): Float32Array;
}

export interface SourceWriteRepositoryOptions {
	readonly records: SourceRecordRepository;
	readonly staging: MediaAssetStagingRepository;
	readonly pcm: PcmRepository;
	readonly opfs: OpfsRepository;
	readonly database: () => Promise<IDBDatabase | null>;
	readonly deleteStoredSource: (source: StorageRecord) => Promise<void>;
}

/** A create-only source write lost its source identity to another publication. */
export class SourceAlreadyExistsError extends Error {
	constructor(sourceId: string) {
		super(`Source ${sourceId} already exists; if-absent publication was refused.`);
		this.name = 'SourceAlreadyExistsError';
	}
}

/** Atomic source publication and bounded PCM writers. */
export class SourceWriteRepository {
	readonly #options: SourceWriteRepositoryOptions;

	constructor(options: SourceWriteRepositoryOptions) {
		this.#options = options;
	}

	createStageReceipt(sourceId: string): AudioSourceStageReceipt {
		if (!sourceId) throw new Error('A source id is required.');
		return Object.freeze({
			version: 1,
			sourceId,
			sourceToken: `${sourceId}:pending:${createId('write')}`,
		});
	}

	begin(sourceId: string, metadata: Record<string, unknown> = {}): Promise<OwnedAudioSourceWriter> {
		return this.beginOwned(this.createStageReceipt(sourceId), metadata);
	}

	async beginOwned(
		receiptValue: unknown,
		metadata: Record<string, unknown> = {},
	): Promise<OwnedAudioSourceWriter> {
		const { requirePersistentPcm, ...persistedMetadata } = metadata;
		const stageReceipt = normalizeAudioSourceStageReceipt(receiptValue);
		const { sourceId, sourceToken: token } = stageReceipt;
		const writeSampleRate = normalizePcmSampleRate(metadata.sampleRate ?? 48_000);
		const declaredChunkFrames = metadata.chunkFrames == null
			? null
			: normalizePcmChunkFrames(metadata.chunkFrames);
		const database = await this.#options.database();
		const opfsWriter = await this.#options.opfs.createPcmWriter(token, persistedMetadata);
		let stage: MediaAssetStagingLease;
		try {
			// The random token is the lease owner, distinct from any media asset using sourceId.
			stage = await this.#options.staging.acquire(token,
				opfsWriter ? { path: opfsWriter.path } : { mediaChunkToken: token }, database);
		} catch (error) {
			await opfsWriter?.abort();
			throw error;
		}
		const persistEncodedChunks = Boolean(opfsWriter || database);
		if (requirePersistentPcm && !persistEncodedChunks) {
			await stage.release();
			throw new Error('Large audio imports require IndexedDB or OPFS storage.');
		}
		let chunkIndex = 0;
		let totalFrames = 0;
		let channelCount: number | null = null;
		let nominalChunkFrames: number | null = null;
		let opfsChunkFrames: number | null = null;
		let previousChunkFrames: number | null = null;
		let regularChunkLayout = true;
		let uncompressedBytes = 0;
		let storedBytes = 0;
		let wavpackChunkCount = 0;
		let rawChunkCount = 0;
		let state: 'open' | 'committing' | 'committed' | 'aborting' | 'aborted' = 'open';
		let activeWrite: Promise<void> | null = null;
		let abortPromise: Promise<void> | null = null;
		const options = this.#options;
		const discardPending = async (): Promise<void> => {
			try {
				if (opfsWriter) await opfsWriter.abort();
				else await options.records.deleteChunks(token);
			} finally { await stage.release(); }
		};
		const assertWriteOpen = (): void => {
			if (state !== 'open') throw new Error('The source writer was closed during an active write.');
		};
		const abortOpenWriter = (): Promise<void> => {
			if (abortPromise) return abortPromise;
			if (state === 'committing' || state === 'committed' || state === 'aborted') return Promise.resolve();
			state = 'aborting';
			const pendingWrite = activeWrite;
			abortPromise = (async () => {
				try {
					if (pendingWrite) await pendingWrite.catch(() => undefined);
					await discardPending();
				} finally {
					state = 'aborted';
				}
			})();
			return abortPromise;
		};
		const failClosed = async (error: Error): Promise<never> => {
			try {
				await abortOpenWriter();
			} catch (cleanupError) {
				throw cleanupFailure(error, cleanupError);
			}
			throw error;
		};

		return {
			stageReceipt,
			get framesWritten() { return totalFrames; },
			async write(inputChannels, { signal } = {}) {
				throwIfAborted(signal);
				if (state === 'aborting') {
					await failClosed(new Error('The source writer is closed.'));
				}
				if (state !== 'open') throw new Error('The source writer is closed.');
				if (activeWrite) {
					await failClosed(new Error('Concurrent source writes are not supported.'));
				}
				let finishWrite!: () => void;
				activeWrite = new Promise<void>((resolve) => { finishWrite = resolve; });
				try {
					await stage.checkpoint();
					const channels = normalizeChannels(inputChannels);
					if (!channels.length) return;
					const frameLength = channels[0].length;
					if (channels.some((channel) => channel.length !== frameLength)) {
						throw new Error('All source channels must contain the same number of frames.');
					}
					if (channelCount === null) channelCount = channels.length;
					if (channels.length !== channelCount) throw new Error('Source channel count changed during a write.');
					if (nominalChunkFrames === null) nominalChunkFrames = frameLength;
					else if (previousChunkFrames !== nominalChunkFrames || frameLength > nominalChunkFrames) regularChunkLayout = false;
					previousChunkFrames = frameLength;
					let storedChunk: StoredChunk;
					if (persistEncodedChunks) {
						storedChunk = await options.pcm.encode(packPlanarFloat32(channels), {
							frames: frameLength,
							channelCount,
							sampleRate: writeSampleRate,
							priority: 'foreground',
							signal,
							allowRawOnFailure: true,
						});
						throwIfAborted(signal);
						assertWriteOpen();
					} else {
						const snapshots = channels.map((channel) => channel.slice());
						const rawBytes = snapshots.reduce((sum, channel) => sum + channel.byteLength, 0);
						storedChunk = {
							encoding: null,
							channels: snapshots.map((channel) => channel.buffer as ArrayBuffer),
							pcmCrc32: crc32(packPlanarFloat32(snapshots)),
							uncompressedBytes: rawBytes,
							storedBytes: rawBytes,
						};
					}
					const record: SourceChunkRecord = {
						key: `${token}:${String(chunkIndex).padStart(10, '0')}`,
						sourceToken: token,
						index: chunkIndex,
						frames: frameLength,
						...(storedChunk.encoding
							? { encoding: storedChunk.encoding, payload: storedChunk.payload, pcmCrc32: storedChunk.pcmCrc32 }
							: { channels: storedChunk.channels }),
						createdAt: Date.now(),
					};
					if (opfsWriter) {
						const writerChunkFrames = positiveInteger(declaredChunkFrames ?? nominalChunkFrames, 0);
						if (!writerChunkFrames) throw new RangeError('A positive source chunk size is required.');
						if (opfsChunkFrames === null) opfsChunkFrames = writerChunkFrames;
						await opfsWriter.write({
							...storedChunk,
							frames: frameLength,
							channelCount,
							sampleRate: writeSampleRate,
							chunkFrames: opfsChunkFrames,
						});
						throwIfAborted(signal);
						assertWriteOpen();
					} else {
						await options.records.writeChunk(record);
						throwIfAborted(signal);
						assertWriteOpen();
					}
					chunkIndex += 1;
					totalFrames += frameLength;
					uncompressedBytes += storedChunk.uncompressedBytes;
					storedBytes += storedChunk.storedBytes;
					if (storedChunk.encoding === PCM_ENCODING_WAVPACK_F32_V1) wavpackChunkCount += 1;
					else rawChunkCount += 1;
				} finally {
					activeWrite = null;
					finishWrite();
				}
			},
			async commit(extraMetadata = {}, { signal, ifAbsent = false } = {}) {
				throwIfAborted(signal);
				if (state === 'aborting') {
					await failClosed(new Error('The source writer is closed.'));
				}
				if (state !== 'open') throw new Error('The source writer is closed.');
				if (activeWrite) {
					await failClosed(new Error('A source cannot be committed while a write is active.'));
				}
				if (!chunkIndex || !channelCount || !totalFrames) {
					throw new Error('A persisted audio source must contain at least one PCM frame.');
				}
				if (extraMetadata.sampleRate != null
					&& normalizePcmSampleRate(extraMetadata.sampleRate) !== writeSampleRate) {
					throw new Error('Source sample rate changed between beginSourceWrite() and commit().');
				}
				const declaredChannelCount = extraMetadata.channelCount ?? metadata.channelCount;
				if (declaredChannelCount != null && Number(declaredChannelCount) !== channelCount) {
					throw new Error('Source channel count changed between beginSourceWrite() and commit().');
				}
				const requestedChunkFrames = extraMetadata.chunkFrames
					?? declaredChunkFrames
					?? (opfsWriter ? opfsChunkFrames : (regularChunkLayout ? nominalChunkFrames : null));
				const committedChunkFrames = requestedChunkFrames == null ? null : normalizePcmChunkFrames(requestedChunkFrames);
				if (opfsWriter && opfsChunkFrames !== null && committedChunkFrames !== opfsChunkFrames) {
					throw new Error('Source chunk size changed between beginSourceWrite() and commit().');
				}
				state = 'committing';
				let previous: StorageRecord | null;
				let writerStatistics: Record<string, unknown> | null;
				try {
					await stage.checkpoint();
					throwIfAborted(signal);
					previous = ifAbsent ? null : await options.records.getMetadata(sourceId);
					throwIfAborted(signal);
					writerStatistics = opfsWriter ? await opfsWriter.close() : null;
					throwIfAborted(signal);
				} catch (error) {
					state = 'aborted';
					try {
						await discardPending();
					} catch (cleanupError) {
						throw cleanupFailure(error, cleanupError);
					}
					throw error;
				}
				const statistics = writerStatistics || compressionStatistics({
					uncompressedBytes,
					storedBytes,
					wavpackChunkCount,
					rawChunkCount,
				});
				const record: StorageRecord = {
					...clone(persistedMetadata),
					...clone(extraMetadata),
					id: sourceId,
					storage: opfsWriter ? PCM_CONTAINER_STORAGE_TYPE : 'indexeddb-chunks',
					sourceToken: token,
					path: opfsWriter?.path,
					channelCount,
					sampleRate: writeSampleRate,
					frameLength: totalFrames,
					frameCount: totalFrames,
					chunkFrames: committedChunkFrames,
					chunkCount: chunkIndex,
					pcmEncodingVersion: persistEncodedChunks ? 1 : undefined,
					...statistics,
					committedAt: new Date().toISOString(),
					pendingProjectUntil: new Date(Date.now() + PENDING_SOURCE_RETENTION_MS).toISOString(),
				};
				let definitelyRefused = false;
				try {
					throwIfAborted(signal);
					if (ifAbsent) {
						if (!await options.records.publishStagedMetadata(record, stage, true)) {
							definitelyRefused = true;
							throw new SourceAlreadyExistsError(sourceId);
						}
					} else await options.records.publishStagedMetadata(record, stage, false);
				} catch (error) {
					if (!definitelyRefused) {
						try {
							if (previous) await options.records.compareAndSwapMetadata(record, previous);
							else await options.records.deleteMetadataIfCurrent(record);
						} catch (reconciliationError) {
							// Keep the new payload if publication cannot be disproved or restored;
							// metadata must never be left pointing at storage we delete here.
							state = 'committed';
							throw cleanupFailure(error, reconciliationError);
						}
					}
					state = 'aborted';
					try {
						await discardPending();
					} catch (cleanupError) {
						throw cleanupFailure(error, cleanupError);
					}
					throw error;
				}
				state = 'committed';
				if (previous) await options.deleteStoredSource(previous).catch(() => undefined);
				return clone(record);
			},
			abort() {
				return abortOpenWriter();
			},
		};
	}

	/** Remove only an unpublished stage carrying this exact random write capability. */
	async discardStageIfCurrent(receiptValue: unknown): Promise<boolean> {
		const receipt = normalizeAudioSourceStageReceipt(receiptValue);
		const current = await this.#options.records.getMetadata(receipt.sourceId);
		if (current?.sourceToken === receipt.sourceToken) return false;
		await Promise.all([
			this.#options.opfs.deletePath(stagePath(receipt.sourceToken)),
			this.#options.records.deleteChunks(receipt.sourceToken),
		]);
		return true;
	}

	writeDerived(
		sourceId: string,
		baseSourceId: string,
		replacementChunks: readonly unknown[],
		metadata: Record<string, unknown> = {},
	): Promise<StorageRecord> {
		return writeDerivedSource(this.#options, sourceId, baseSourceId, replacementChunks, metadata);
	}

	async writeAudioBuffer(
		sourceId: string,
		audioBuffer: AudioBufferLike,
		metadata: Record<string, unknown> = {},
		{ chunkFrames = 65_536 } = {},
	): Promise<StorageRecord> {
		if (!audioBuffer?.numberOfChannels || !audioBuffer?.length || !audioBuffer?.getChannelData) {
			throw new TypeError('A non-empty AudioBuffer is required.');
		}
		const boundedChunkFrames = normalizePcmChunkFrames(chunkFrames ?? 65_536);
		const writer = await this.begin(sourceId, {
			...metadata,
			sampleRate: audioBuffer.sampleRate,
			channelCount: audioBuffer.numberOfChannels,
			chunkFrames: boundedChunkFrames,
		});
		try {
			for (let offset = 0; offset < audioBuffer.length; offset += boundedChunkFrames) {
				const end = Math.min(audioBuffer.length, offset + boundedChunkFrames);
				const channels = Array.from(
					{ length: audioBuffer.numberOfChannels },
					(_, channel) => audioBuffer.getChannelData(channel).subarray(offset, end),
				);
				await writer.write(channels);
			}
			return await writer.commit();
		} catch (error) {
			await writer.abort();
			throw error;
		}
	}
}

export function normalizeAudioSourceStageReceipt(value: unknown): AudioSourceStageReceipt {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError('Audio source stage receipt must be a closed data record.');
	}
	const record = value as Record<PropertyKey, unknown>;
	const keys = Reflect.ownKeys(record);
	const expectedKeys = ['version', 'sourceId', 'sourceToken'];
	if (keys.length !== expectedKeys.length || expectedKeys.some((key) => !keys.includes(key))) {
		throw new TypeError('Audio source stage receipt has an invalid closed shape.');
	}
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(record, key);
		if (typeof key !== 'string' || !descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Audio source stage receipt.${String(key)} must be an enumerable data property.`);
		}
	}
	if (record.version !== 1) throw new RangeError('Audio source stage receipt version must be 1.');
	const sourceId = canonicalReceiptText(record.sourceId, 'sourceId');
	const sourceToken = canonicalReceiptText(record.sourceToken, 'sourceToken');
	if (!sourceToken.startsWith(`${sourceId}:pending:write-`)) {
		throw new Error('Audio source stage receipt token does not belong to sourceId.');
	}
	return Object.freeze({
		version: 1,
		sourceId,
		sourceToken,
	});
}

function stagePath(sourceToken: string): string {
	return `${sourceToken.replace(/[^a-z0-9._-]+/giu, '-')}${PCM_CONTAINER_EXTENSION}`;
}

function canonicalReceiptText(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.length || value !== value.trim()
		|| value !== value.normalize('NFC') || value.length > 1_024
		|| /[\u0000-\u001f\u007f]/u.test(value)) {
		throw new TypeError(`Audio source stage receipt ${name} must be canonical text.`);
	}
	return value;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('The source write was cancelled.', 'AbortError');
}
