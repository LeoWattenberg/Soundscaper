/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PCM_CONTAINER_STORAGE_TYPE,
	PCM_ENCODING_WAVPACK_F32_V1,
	PcmStorageCorruptionError,
	compressionStatistics,
	exactArrayBuffer,
	packPlanarFloat32,
	pcmRawByteLength,
} from '../wavpack/index.js';
import {
	sameStoredSourceIdentity,
	sourceChunkFromLegacyRecord,
	sourceNeedsLegacyPcmMigration,
	type StorageRecord,
} from './media-records.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { PcmRepository } from './pcm-repository.ts';
import type { SourceChunkRecord, SourceRecordRepository } from './source-record-repository.ts';

interface StorageEstimate {
	readonly usage: number | null;
	readonly quota: number | null;
}

export interface PcmMigrationRepositoryOptions {
	readonly records: SourceRecordRepository;
	readonly pcm: PcmRepository;
	readonly opfs: OpfsRepository;
	readonly database: () => Promise<IDBDatabase | null>;
	readonly estimateStorage: () => Promise<StorageEstimate>;
	readonly isMemoryBackend: () => boolean;
	readonly migrateOnAccess: boolean;
}

/** Background conversion of legacy PCM records into the current adaptive format. */
export class PcmMigrationRepository {
	readonly #options: PcmMigrationRepositoryOptions;
	readonly #failures = new Set<string>();
	readonly #promises = new Map<string, Promise<void>>();
	readonly #controllers = new Map<string, AbortController>();

	constructor(options: PcmMigrationRepositoryOptions) {
		this.#options = options;
	}

	pendingSourceIds(): string[] {
		return [...this.#promises.keys()];
	}

	forgetFailures(sourceIds: Iterable<string>): void {
		for (const sourceId of sourceIds) this.#failures.delete(sourceId);
	}

	queue(source: StorageRecord): void {
		const sourceId = source.id;
		if (!sourceId
			|| !this.#options.migrateOnAccess
			|| !sourceNeedsLegacyPcmMigration(source)
			|| (this.#options.isMemoryBackend() && source.storage !== 'opfs')
			|| this.#failures.has(sourceId)
			|| this.#promises.has(sourceId)) {
			return;
		}
		const controller = new AbortController();
		this.#controllers.set(sourceId, controller);
		const promise = new Promise<void>((resolve) => { setTimeout(resolve, 0); })
			.then(async () => {
				throwIfAborted(controller.signal);
				await this.#migrateSource(clone(source), controller.signal);
			})
			.catch((error: unknown) => {
				if (!isAbortError(error)) this.#failures.add(sourceId);
			})
			.finally(() => {
				if (this.#promises.get(sourceId) === promise) {
					this.#promises.delete(sourceId);
					this.#controllers.delete(sourceId);
				}
			});
		this.#promises.set(sourceId, promise);
	}

	async cancel(sourceId: string): Promise<void> {
		const id = String(sourceId);
		this.#controllers.get(id)?.abort();
		const promise = this.#promises.get(id);
		if (promise) await promise.catch(() => undefined);
		this.#promises.delete(id);
		this.#controllers.delete(id);
		this.#failures.delete(id);
	}

	async stop({ closeCodec = false, clearFailures = true } = {}): Promise<void> {
		for (const controller of this.#controllers.values()) controller.abort();
		await Promise.allSettled(this.#promises.values());
		this.#promises.clear();
		this.#controllers.clear();
		if (clearFailures) this.#failures.clear();
		this.#options.opfs.clearCache();
		if (closeCodec) this.#options.pcm.closeOwnedCodec();
	}

	async #migrateSource(source: StorageRecord, signal: AbortSignal): Promise<void> {
		if (!source.id) return;
		const current = await this.#options.records.getMetadata(source.id);
		if (!sameStoredSourceIdentity(current, source) || !sourceNeedsLegacyPcmMigration(current)) return;
		if (source.storage === 'opfs') {
			await this.#migrateOpfsSource(source, signal);
			return;
		}
		if (source.storage === 'indexeddb-chunks' || source.storage === 'copy-on-write') {
			await this.#migrateIndexedDbSource(source, signal);
		}
	}

	async #migrateOpfsSource(source: StorageRecord, signal: AbortSignal): Promise<void> {
		const channelCount = positiveInteger(source.channelCount, 0);
		const frameCount = positiveInteger(source.frameCount ?? source.frameLength, 0);
		const chunkFrames = positiveInteger(source.chunkFrames, 0);
		const chunkCount = positiveInteger(source.chunkCount, 0);
		if (!source.id || !channelCount || !frameCount || !chunkFrames || !chunkCount) {
			throw new PcmStorageCorruptionError(
				'Legacy OPFS source metadata is incomplete.',
				'PCM_MIGRATION_GEOMETRY',
			);
		}
		await this.#requireOpfsHeadroom({ frameCount, channelCount, chunkCount });
		throwIfAborted(signal);
		const token = `${source.id}:migration:${createId('write')}`;
		const writer = await this.#options.opfs.createPcmWriter(token, source);
		if (!writer) throw new Error('Origin-private audio storage is unavailable for PCM migration.');
		let published = false;
		try {
			let index = 0;
			let migratedFrames = 0;
			for await (const chunk of this.#options.opfs.readLegacyChunks(source)) {
				throwIfAborted(signal);
				if (chunk.index !== index || chunk.channels.length !== channelCount || chunk.frames > chunkFrames) {
					throw new PcmStorageCorruptionError(
						'Legacy OPFS source contains invalid chunk geometry.',
						'PCM_MIGRATION_GEOMETRY',
					);
				}
				const stored = await this.#options.pcm.encode(packPlanarFloat32(chunk.channels), {
					frames: chunk.frames,
					channelCount,
					sampleRate: Number(source.sampleRate) || 48_000,
					priority: 'migration',
					signal,
					allowRawOnFailure: false,
				});
				await writer.write({
					...stored,
					frames: chunk.frames,
					channelCount,
					sampleRate: Number(source.sampleRate) || 48_000,
					chunkFrames,
				});
				index += 1;
				migratedFrames += chunk.frames;
				await yieldMigration(signal);
			}
			if (index !== chunkCount || migratedFrames !== frameCount) {
				throw new PcmStorageCorruptionError(
					'Legacy OPFS source does not match its chunk or frame count.',
					'PCM_MIGRATION_GEOMETRY',
				);
			}
			const statistics = await writer.close();
			const replacement: StorageRecord = {
				...source,
				storage: PCM_CONTAINER_STORAGE_TYPE,
				sourceToken: token,
				path: writer.path,
				pcmEncodingVersion: 1,
				...statistics,
				migratedAt: new Date().toISOString(),
			};
			this.#options.opfs.invalidate(writer.path);
			let verifiedChunks = 0;
			let verifiedFrames = 0;
			for await (const chunk of this.#options.opfs.readPcmContainerChunks(
				replacement,
				this.#options.pcm.decodeRecord.bind(this.#options.pcm),
				{ priority: 'migration', signal },
			)) {
				verifiedChunks += 1;
				verifiedFrames += chunk.frames;
				await yieldMigration(signal);
			}
			if (verifiedChunks !== chunkCount || verifiedFrames !== frameCount) {
				throw new PcmStorageCorruptionError(
					'Migrated OPFS source failed complete verification.',
					'PCM_MIGRATION_VERIFY',
				);
			}
			throwIfAborted(signal);
			published = await this.#options.records.compareAndSwapMetadata(source, replacement);
			if (!published) throw new Error('PCM migration lost a source metadata compare-and-swap race.');
			await this.#options.opfs.deletePath(source.path);
		} finally {
			if (!published) {
				this.#options.opfs.invalidate(writer.path);
				await writer.abort().catch(() => undefined);
			}
		}
	}

	async #migrateIndexedDbSource(source: StorageRecord, signal: AbortSignal): Promise<void> {
		if (!await this.#options.database()) throw new Error('IndexedDB is unavailable for PCM migration.');
		const channelCount = positiveInteger(source.channelCount, 0);
		const expectedRecords = source.storage === 'copy-on-write'
			? nonNegativeInteger(source.overrideChunkCount, -1)
			: nonNegativeInteger(source.chunkCount, -1);
		if (!source.sourceToken || !channelCount || expectedRecords < 0) {
			throw new PcmStorageCorruptionError(
				'Legacy IndexedDB source metadata is incomplete.',
				'PCM_MIGRATION_GEOMETRY',
			);
		}
		let recordCount = 0;
		let uncompressedBytes = 0;
		let storedBytes = 0;
		let wavpackChunkCount = 0;
		let rawChunkCount = 0;
		for await (const storedRecord of this.#options.records.chunks(source.sourceToken)) {
			throwIfAborted(signal);
			let record: SourceChunkRecord = storedRecord;
			if (Array.isArray(record.channels)) {
				const legacyChunk = sourceChunkFromLegacyRecord(record);
				if (legacyChunk.channels.length !== channelCount) {
					throw new PcmStorageCorruptionError(
						'Legacy IndexedDB source has an invalid channel count.',
						'PCM_MIGRATION_GEOMETRY',
					);
				}
				const encoded = await this.#options.pcm.encode(packPlanarFloat32(legacyChunk.channels), {
					frames: legacyChunk.frames,
					channelCount,
					sampleRate: Number(source.sampleRate) || 48_000,
					priority: 'migration',
					signal,
					allowRawOnFailure: false,
				});
				const { channels: _legacyChannels, ...preserved } = record;
				record = {
					...preserved,
					encoding: encoded.encoding,
					payload: encoded.payload,
					pcmCrc32: encoded.pcmCrc32,
				} as SourceChunkRecord;
				await this.#verifyRecord(record, source, signal);
				if (!await this.#options.records.replaceChunkIfCurrent(source, record)) {
					throw new Error('PCM migration lost a source-record compare-and-swap race.');
				}
			} else {
				await this.#verifyRecord(record, source, signal);
			}
			const rawBytes = pcmRawByteLength(Number(record.frames), channelCount);
			const payloadBytes = Array.isArray(record.channels)
				? rawBytes
				: exactBuffer(record.payload).byteLength;
			uncompressedBytes += rawBytes;
			storedBytes += payloadBytes;
			if (record.encoding === PCM_ENCODING_WAVPACK_F32_V1) wavpackChunkCount += 1;
			else rawChunkCount += 1;
			recordCount += 1;
			await yieldMigration(signal);
		}
		if (recordCount !== expectedRecords) {
			throw new PcmStorageCorruptionError(
				'Legacy IndexedDB source does not match its expected record count.',
				'PCM_MIGRATION_GEOMETRY',
			);
		}
		const replacement: StorageRecord = {
			...source,
			pcmEncodingVersion: 1,
			...compressionStatistics({ uncompressedBytes, storedBytes, wavpackChunkCount, rawChunkCount }),
			migratedAt: new Date().toISOString(),
		};
		throwIfAborted(signal);
		if (!await this.#options.records.compareAndSwapMetadata(source, replacement)) {
			throw new Error('PCM migration lost a source metadata compare-and-swap race.');
		}
	}

	async #verifyRecord(record: SourceChunkRecord, source: StorageRecord, signal: AbortSignal): Promise<void> {
		await this.#options.pcm.decodeRecord({
			...record,
			payload: exactBuffer(record.payload).slice(0),
		}, source, signal, 'migration');
	}

	async #requireOpfsHeadroom({
		frameCount,
		channelCount,
		chunkCount,
	}: {
		readonly frameCount: number;
		readonly channelCount: number;
		readonly chunkCount: number;
	}): Promise<void> {
		const rawBytes = frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT;
		const containerBytes = rawBytes + 32 + chunkCount * 24 + 32;
		if (!Number.isSafeInteger(containerBytes)) {
			throw new RangeError('Legacy PCM migration exceeds safe browser storage bounds.');
		}
		const required = Math.ceil(containerBytes * 1.1);
		const estimate = await this.#options.estimateStorage();
		if (Number.isFinite(estimate.usage)
			&& Number.isFinite(estimate.quota)
			&& Number(estimate.quota) - Number(estimate.usage) < required) {
			const error = new Error(`PCM migration requires ${required} bytes of temporary storage headroom.`) as Error & { code: string };
			error.name = 'QuotaExceededError';
			error.code = 'PCM_MIGRATION_QUOTA';
			throw error;
		}
	}
}

async function yieldMigration(signal: AbortSignal): Promise<void> {
	throwIfAborted(signal);
	await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
	throwIfAborted(signal);
}

function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	const error = new Error('Audio source loading was cancelled.');
	error.name = 'AbortError';
	throw error;
}

function isAbortError(error: unknown): boolean {
	return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

function clone<Value>(value: Value): Value {
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

function exactBuffer(value: unknown): ArrayBuffer {
	return exactArrayBuffer(value) as ArrayBuffer;
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
