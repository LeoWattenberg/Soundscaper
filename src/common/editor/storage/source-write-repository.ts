/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PCM_CONTAINER_STORAGE_TYPE,
	PCM_CONTAINER_EXTENSION,
	PCM_ENCODING_WAVPACK_F32_V1,
	WAVPACK_PCM_MAXIMUM_FRAMES,
	compressionStatistics,
	crc32,
	normalizePcmSampleRate,
	packPlanarFloat32,
} from '../wavpack/index.js';
import { normalizeChannels, type StorageRecord } from './media-records.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { PcmRepository } from './pcm-repository.ts';
import type { SourceChunkRecord, SourceRecordRepository } from './source-record-repository.ts';

const PENDING_SOURCE_RETENTION_MS = 24 * 60 * 60 * 1000;

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
	readonly pcm: PcmRepository;
	readonly opfs: OpfsRepository;
	readonly database: () => Promise<IDBDatabase | null>;
	readonly deleteStoredSource: (source: StorageRecord) => Promise<void>;
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
		const stageReceipt = normalizeAudioSourceStageReceipt(receiptValue);
		const { sourceId, sourceToken: token } = stageReceipt;
		const writeSampleRate = normalizePcmSampleRate(metadata.sampleRate ?? 48_000);
		const declaredChunkFrames = metadata.chunkFrames == null
			? null
			: normalizePcmChunkFrames(metadata.chunkFrames);
		const database = await this.#options.database();
		const opfsWriter = await this.#options.opfs.createPcmWriter(token, metadata);
		const persistEncodedChunks = Boolean(opfsWriter || database);
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
		let state: 'open' | 'committing' | 'committed' | 'aborted' = 'open';
		const options = this.#options;
		const discardPending = async (): Promise<void> => {
			if (opfsWriter) await opfsWriter.abort();
			else await options.records.deleteChunks(token);
		};

		return {
			stageReceipt,
			get framesWritten() { return totalFrames; },
			async write(inputChannels, { signal } = {}) {
				throwIfAborted(signal);
				if (state !== 'open') throw new Error('The source writer is closed.');
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
				} else {
					await options.records.writeChunk(record);
					throwIfAborted(signal);
				}
				chunkIndex += 1;
				totalFrames += frameLength;
				uncompressedBytes += storedChunk.uncompressedBytes;
				storedBytes += storedChunk.storedBytes;
				if (storedChunk.encoding === PCM_ENCODING_WAVPACK_F32_V1) wavpackChunkCount += 1;
				else rawChunkCount += 1;
			},
			async commit(extraMetadata = {}, { signal, ifAbsent = false } = {}) {
				throwIfAborted(signal);
				if (state !== 'open') throw new Error('The source writer is closed.');
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
					...clone(metadata),
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
						if (!await options.records.putMetadataIfAbsent(record)) {
							definitelyRefused = true;
							throw new Error(`Source ${sourceId} already exists; if-absent publication was refused.`);
						}
					} else await options.records.putMetadata(record);
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
			async abort() {
				if (state !== 'open') return;
				state = 'aborted';
				await discardPending();
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

	async writeDerived(
		sourceId: string,
		baseSourceId: string,
		replacementChunks: readonly unknown[],
		metadata: Record<string, unknown> = {},
	): Promise<StorageRecord> {
		if (!sourceId || !baseSourceId || sourceId === baseSourceId) throw new Error('Distinct source and base source ids are required.');
		if (!Array.isArray(replacementChunks) || !replacementChunks.length) throw new Error('At least one replacement source chunk is required.');
		const incomingChunks = replacementChunks.map((value) => {
			const input = asRecord(value);
			return { index: input?.index, channels: normalizeChannels(input?.channels).map((channel) => channel.slice()) };
		});
		const base = await this.#options.records.getMetadata(baseSourceId);
		if (!base) throw new Error('The immutable base source could not be found.');
		if (await this.#options.records.getMetadata(sourceId)) throw new Error('Immutable source ids cannot be overwritten.');
		const channelCount = positiveInteger(base.channelCount, 64);
		const frameCount = positiveInteger(base.frameCount ?? base.frameLength, Number.MAX_SAFE_INTEGER);
		const chunkFrames = normalizePcmChunkFrames(metadata.chunkFrames ?? base.chunkFrames ?? 65_536);
		const expectedChunkCount = Math.ceil(frameCount / chunkFrames);
		const token = `${sourceId}:cow:${createId('write')}`;
		const seenIndices = new Set<number>();
		const chunks = incomingChunks.map((input, replacementIndex) => {
			const index = nonNegativeInteger(input.index, -1);
			if (index < 0 || index >= expectedChunkCount || seenIndices.has(index)) throw new Error('A derived source contains an invalid replacement chunk index.');
			seenIndices.add(index);
			if (input.channels.length !== channelCount) throw new Error('A derived source replacement has the wrong channel count.');
			const expectedFrames = index === expectedChunkCount - 1 ? frameCount - index * chunkFrames : chunkFrames;
			if (input.channels[0]?.length !== expectedFrames) throw new Error('A derived source replacement has the wrong frame count.');
			return { ...input, index, frames: expectedFrames, createdAt: Date.now() + replacementIndex };
		});
		const database = await this.#options.database();
		let uncompressedBytes = 0;
		let storedBytes = 0;
		let wavpackChunkCount = 0;
		let rawChunkCount = 0;
		try {
			for (const chunk of chunks) {
				let record: SourceChunkRecord;
				if (database) {
					const stored = await this.#options.pcm.encode(packPlanarFloat32(chunk.channels), {
						frames: chunk.frames,
						channelCount,
						sampleRate: Number(metadata.sampleRate ?? base.sampleRate ?? 48_000),
						priority: 'foreground',
						allowRawOnFailure: true,
					});
					record = chunkRecord(token, chunk.index, chunk.frames, chunk.createdAt, stored);
					uncompressedBytes += stored.uncompressedBytes;
					storedBytes += stored.storedBytes;
					if (stored.encoding === PCM_ENCODING_WAVPACK_F32_V1) wavpackChunkCount += 1;
					else rawChunkCount += 1;
				} else {
					record = {
						key: chunkKey(token, chunk.index), sourceToken: token, index: chunk.index,
						frames: chunk.frames,
						channels: chunk.channels.map((channel) => channel.buffer.slice(0)),
						createdAt: chunk.createdAt,
					};
					const rawBytes = chunk.frames * channelCount * Float32Array.BYTES_PER_ELEMENT;
					uncompressedBytes += rawBytes;
					storedBytes += rawBytes;
					rawChunkCount += 1;
				}
				await this.#options.records.writeChunk(record);
			}
		} catch (error) {
			await this.#options.records.deleteChunks(token);
			throw error;
		}
		const record: StorageRecord = {
			...clone(metadata),
			id: sourceId,
			storage: 'copy-on-write',
			baseSourceId,
			sourceToken: token,
			channelCount,
			frameLength: frameCount,
			frameCount,
			chunkFrames,
			chunkCount: expectedChunkCount,
			overrideChunkCount: chunks.length,
			sampleRate: metadata.sampleRate ?? base.sampleRate,
			pcmEncodingVersion: database ? 1 : undefined,
			...compressionStatistics({ uncompressedBytes, storedBytes, wavpackChunkCount, rawChunkCount }),
			committedAt: new Date().toISOString(),
			pendingProjectUntil: new Date(Date.now() + PENDING_SOURCE_RETENTION_MS).toISOString(),
		};
		try {
			await this.#options.records.putMetadata(record);
		} catch (error) {
			await this.#options.records.deleteChunks(token);
			throw error;
		}
		return clone(record);
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

function cleanupFailure(primary: unknown, cleanup: unknown): AggregateError {
	const aggregate = new AggregateError([primary, cleanup], 'The source write and its cleanup both failed.');
	if (primary instanceof Error && primary.name === 'AbortError') aggregate.name = 'AbortError';
	return aggregate;
}

function chunkRecord(
	token: string,
	index: number,
	frames: number,
	createdAt: number,
	stored: StoredChunk,
): SourceChunkRecord {
	return {
		key: chunkKey(token, index), sourceToken: token, index, frames,
		encoding: stored.encoding, payload: stored.payload, pcmCrc32: stored.pcmCrc32, createdAt,
	};
}

function chunkKey(token: string, index: number): string {
	return `${token}:${String(index).padStart(10, '0')}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function clone<Value>(value: Value): Value {
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

function createId(prefix: string): string {
	if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function positiveInteger(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function normalizePcmChunkFrames(value: unknown): number {
	const frames = Number(value);
	if (!Number.isSafeInteger(frames) || frames < 1 || frames > WAVPACK_PCM_MAXIMUM_FRAMES) {
		throw new RangeError(`PCM chunk size must be an integer between 1 and ${WAVPACK_PCM_MAXIMUM_FRAMES} frames.`);
	}
	return frames;
}
