/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';

import {
	MediaAssetChunkRecords,
	mediaAssetChunkKey,
	mediaAssetChunkRecord,
} from './media-asset-chunk-records.ts';
import { MEDIA_ASSET_CHUNK_STORAGE_TYPE } from './media-asset-chunk-schema.ts';
import {
	MediaAssetWriteCoordinator,
	type MediaAssetWriteMaintenance,
} from './media-asset-write-coordinator.ts';
import { MediaAssetDisposalRepository } from './media-asset-disposal-repository.ts';
import {
	abortPreparedMediaAssetStaging,
	prepareMediaAssetStaging,
	type PreparedMediaAssetStaging,
} from './media-asset-staged-sink.ts';
import {
	type ActiveMediaAssetStaging,
	type MediaAssetStagingLease,
	MediaAssetStagingRepository,
} from './media-asset-staging-repository.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from './media-asset-staging-schema.ts';
import {
	freshVerifiedMediaContentDigest,
	isMediaContentSha256,
	trustedMediaContentSha256,
} from './media-content-provenance.ts';
import {
	binaryMetadata,
	mediaAssetMetadata,
	type BlobLike,
	type StorageRecord,
} from './media-records.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import { request, transact } from './indexeddb-backend.ts';

export const MEDIA_ASSET_STREAM_CHUNK_BYTES = 4 * 1024 * 1024;
export const MEDIA_ASSET_MEMORY_STREAM_MAXIMUM_BYTES = 64 * 1024 * 1024;
export { MEDIA_ASSET_CHUNK_STORAGE_TYPE };

const PENDING_SOURCE_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface MediaAssetWriteOptions {
	readonly expectedBytes: number;
	readonly expectedSha256: string;
	readonly signal?: AbortSignal;
}

export interface MediaAssetWriter {
	readonly maximumChunkBytes: number;
	readonly bytesWritten: number;
	write(bytes: Uint8Array, options?: Readonly<{ signal?: AbortSignal }>): Promise<void>;
	commit(options?: Readonly<{ signal?: AbortSignal }>): Promise<Readonly<Record<string, unknown>>>;
	abort(): Promise<void>;
}

interface ManagedMediaAssetWriter {
	readonly writer: MediaAssetWriter;
	abortForMaintenance(): Promise<void>;
}

/** Transactional streaming publication for immutable original media containers. */
export class MediaAssetWriteRepository {
	readonly #port: StorageRepositoryPort;
	readonly #opfs: OpfsRepository;
	readonly #chunks: MediaAssetChunkRecords;
	readonly #staging: MediaAssetStagingRepository;
	readonly #coordinator = new MediaAssetWriteCoordinator();
	readonly #disposal: MediaAssetDisposalRepository;

	constructor(port: StorageRepositoryPort, opfs: OpfsRepository) {
		this.#port = port;
		this.#opfs = opfs;
		this.#chunks = new MediaAssetChunkRecords(port);
		this.#staging = new MediaAssetStagingRepository(port);
		this.#disposal = new MediaAssetDisposalRepository(
			port,
			this.#chunks,
			() => this.#coordinator.activePaths(),
			(identity) => this.#staging.isActive(identity),
		);
	}

	async begin(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
		options: MediaAssetWriteOptions,
	): Promise<MediaAssetWriter> {
		this.#coordinator.assertAccepting();
		const id = nonEmptyString(sourceId, 'A media source id is required.');
		const expectedBytes = nonNegativeSafeInteger(
			options?.expectedBytes,
			'A streamed media asset requires an expected byte length.',
		);
		const expectedSha256 = String(options?.expectedSha256 || '').toLowerCase();
		if (!isMediaContentSha256(expectedSha256)) {
			throw new TypeError('A streamed media asset requires an expected SHA-256 digest.');
		}
		throwIfAborted(options.signal);
		const database = await this.#port.database();
		throwIfAborted(options.signal);
		if (await this.#assetExists(id, database)) {
			throw new Error(`Immutable media asset ${id} cannot be overwritten.`);
		}
		const prepared = await prepareMediaAssetStaging({
			sourceId: id,
			expectedBytes,
			maximumMemoryBytes: MEDIA_ASSET_MEMORY_STREAM_MAXIMUM_BYTES,
			database,
			chunks: this.#chunks,
			staging: this.#staging,
			opfs: this.#opfs,
			signal: options.signal,
		});
		let registration;
		try {
			registration = this.#coordinator.register({
				mediaChunkToken: prepared.sink.mediaChunkToken,
				path: prepared.sink.path,
			});
		} catch (error) {
			try {
				await abortPreparedMediaAssetStaging(prepared);
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Media writer admission and staged-payload cleanup both failed.',
				);
			}
			throw error;
		}
		const managed = this.#writer(
			id,
			metadata,
			expectedBytes,
			expectedSha256,
			prepared,
			registration.release,
			database,
			options.signal,
		);
		registration.attachAbort(managed.abortForMaintenance);
		return managed.writer;
	}

	beginMaintenance(options: Readonly<{ permanent?: boolean }> = {}): MediaAssetWriteMaintenance {
		return this.#coordinator.beginMaintenance(options);
	}

	activeStaging(): Promise<ActiveMediaAssetStaging> { return this.#staging.activeIdentities(); }
	invalidateStagingMemory(): ActiveMediaAssetStaging { return this.#staging.invalidateMemory(); }
	invalidateStagingStore(store: IDBObjectStore): Promise<ActiveMediaAssetStaging> {
		return this.#staging.invalidateStore(store);
	}

	async load(
		record: StorageRecord,
		missingMessage: string,
		{ signal }: Readonly<{ signal?: AbortSignal }> = {},
	): Promise<BlobLike> {
		throwIfAborted(signal);
		if (record.storage !== MEDIA_ASSET_CHUNK_STORAGE_TYPE) {
			const loaded = await this.#opfs.loadBinaryRecord(record, missingMessage);
			throwIfAborted(signal);
			return loaded;
		}
		const sourceId = record.sourceId;
		const token = typeof record.mediaChunkToken === 'string' ? record.mediaChunkToken : '';
		const expectedBytes = record.size;
		const expectedSha256 = trustedMediaContentSha256(record);
		if (typeof sourceId !== 'string'
			|| sourceId.length < 1
			|| !token
			|| typeof expectedBytes !== 'number'
			|| !Number.isSafeInteger(expectedBytes)
			|| expectedBytes < 0) throw new Error(missingMessage);
		const expectedChunks = expectedBytes === 0
			? 0
			: Math.ceil(expectedBytes / MEDIA_ASSET_STREAM_CHUNK_BYTES);
		if (record.mediaChunkBytes !== MEDIA_ASSET_STREAM_CHUNK_BYTES
			|| typeof record.mediaChunkCount !== 'number'
			|| !Number.isSafeInteger(record.mediaChunkCount)
			|| record.mediaChunkCount < 0
			|| record.mediaChunkCount !== expectedChunks) throw new Error(missingMessage);
		const parts: Blob[] = [];
		const digest = expectedSha256 ? sha256.create() : null;
		let index = 0;
		let size = 0;
		for await (const { primaryKey, value } of this.#chunks.chunks(token)) {
			throwIfAborted(signal);
			const chunk = mediaAssetChunkRecord(value);
			if (!chunk) throw new Error(missingMessage);
			const expectedChunkBytes = Math.min(MEDIA_ASSET_STREAM_CHUNK_BYTES, expectedBytes - size);
			if (primaryKey !== chunk.key
				|| chunk.key !== mediaAssetChunkKey(token, index)
				|| chunk.sourceId !== sourceId
				|| chunk.mediaChunkToken !== token
				|| chunk.index !== index
				|| expectedChunkBytes < 1
				|| chunk.byteLength !== chunk.payload.size
				|| chunk.payload.size !== expectedChunkBytes) throw new Error(missingMessage);
			if (digest) {
				const buffer = await chunk.payload.arrayBuffer();
				throwIfAborted(signal);
				if (buffer.byteLength !== expectedChunkBytes) throw new Error(missingMessage);
				digest.update(new Uint8Array(buffer));
			}
			parts.push(chunk.payload);
			size += chunk.payload.size;
			index += 1;
		}
		throwIfAborted(signal);
		if (size !== expectedBytes
			|| index !== expectedChunks
			|| (digest && hex(digest.digest()) !== expectedSha256)) throw new Error(missingMessage);
		return new Blob(parts, { type: String(record.mimeType || '') });
	}

	async prepareDetachedPayloadDisposal(record: StorageRecord): Promise<StorageRecord | null> {
		return this.#disposal.prepare(record);
	}

	async cleanupStaleChunks(
		records: readonly StorageRecord[],
		cutoff: number,
		protectedTokens: ReadonlySet<string> = new Set(),
	): Promise<void> {
		const retained = new Set(records.map(({ mediaChunkToken }) => mediaChunkToken).filter(isString));
		for (const token of protectedTokens) retained.add(token);
		await this.#chunks.cleanupStale(retained, cutoff);
	}

	#writer(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
		expectedBytes: number,
		expectedSha256: string,
		prepared: PreparedMediaAssetStaging,
		onSettled: () => void,
		database: IDBDatabase | null,
		defaultSignal?: AbortSignal,
	): ManagedMediaAssetWriter {
		const { lease, sink } = prepared;
		const digest = sha256.create();
		const pendingCapacity = Math.min(expectedBytes, MEDIA_ASSET_STREAM_CHUNK_BYTES);
		let pending = pendingCapacity ? new Uint8Array(pendingCapacity) : new Uint8Array();
		let pendingBytes = 0;
		let bytesWritten = 0;
		let chunkIndex = 0;
		let state: 'open' | 'committing' | 'committed' | 'aborted' | 'indeterminate' = 'open';
		let activeWrite: Promise<void> | null = null;
		let commitPromise: Promise<Readonly<Record<string, unknown>>> | null = null;
		let cleanupPromise: Promise<void> | null = null;
		let abortPromise: Promise<void> | null = null;
		let maintenanceAbortPromise: Promise<void> | null = null;
		let maintenanceAborted = false;
		let publicationStarted = false;
		const maintenanceAbortReason = new DOMException('Media storage maintenance cancelled the write.', 'AbortError');
		const throwIfMaintenanceAborted = (): void => {
			if (maintenanceAborted) throw maintenanceAbortReason;
		};
		const cleanup = (): Promise<void> => {
			cleanupPromise ??= abortPreparedMediaAssetStaging(prepared);
			return cleanupPromise;
		};
		const abortWith = async (primary: unknown): Promise<never> => {
			state = 'aborted';
			try {
				await cleanup();
			} catch (cleanupError) {
				throw new AggregateError([primary, cleanupError], 'Media staging and cleanup both failed.');
			} finally {
				onSettled();
			}
			throw primary;
		};
		const flush = async (signal?: AbortSignal): Promise<void> => {
			if (!pendingBytes) return;
			throwIfMaintenanceAborted();
			const chunk = pendingBytes === pending.byteLength ? pending : pending.slice(0, pendingBytes);
			await sink.write(chunk, chunkIndex, signal);
			throwIfMaintenanceAborted();
			chunkIndex += 1;
			pending = pendingCapacity ? new Uint8Array(pendingCapacity) : new Uint8Array();
			pendingBytes = 0;
		};
		const performCommit = async (
			options: Readonly<{ signal?: AbortSignal }>,
		): Promise<Readonly<Record<string, unknown>>> => {
			const signal = options.signal ?? defaultSignal;
			try {
				if (activeWrite) await activeWrite;
				await lease.checkpoint();
				throwIfMaintenanceAborted();
				throwIfAborted(signal);
				if (bytesWritten !== expectedBytes) {
					throw new Error('Streamed media bytes do not match the declared asset size.');
				}
				await flush(signal);
				const actualSha256 = hex(digest.digest());
				if (actualSha256 !== expectedSha256) {
					throw new Error('Streamed media SHA-256 verification failed.');
				}
				await sink.close(signal);
				throwIfMaintenanceAborted();
				throwIfAborted(signal);
				const record: StorageRecord = {
					...binaryMetadata(metadata),
					sourceId,
					...freshVerifiedMediaContentDigest(actualSha256),
					storage: sink.storage,
					path: sink.path,
					mediaChunkToken: sink.mediaChunkToken,
					mediaChunkBytes: sink.mediaChunkToken ? MEDIA_ASSET_STREAM_CHUNK_BYTES : undefined,
					mediaChunkCount: sink.mediaChunkToken ? chunkIndex : undefined,
					size: expectedBytes,
					mimeType: String(metadata.mimeType || ''),
					name: String(metadata.name || ''),
					lastModified: nonNegativeInteger(metadata.lastModified, 0),
					committedAt: new Date().toISOString(),
					pendingProjectUntil: new Date(Date.now() + PENDING_SOURCE_RETENTION_MS).toISOString(),
				};
				publicationStarted = true;
				await this.#publish(record, signal, database, lease);
				state = 'committed';
				onSettled();
				return mediaAssetMetadata(record);
			} catch (error) {
				if (error instanceof MediaPublicationReconciliationError) {
					state = 'indeterminate';
					onSettled();
					throw error;
				}
				return abortWith(error);
			}
		};
		const writer: MediaAssetWriter = {
			maximumChunkBytes: MEDIA_ASSET_STREAM_CHUNK_BYTES,
			get bytesWritten() { return bytesWritten; },
			write: (input, options = {}) => {
				if (state !== 'open') throw new Error('The streamed media writer is closed.');
				if (activeWrite) throw new Error('A streamed media write is already in progress.');
				const signal = options.signal ?? defaultSignal;
				const operation = (async (): Promise<void> => {
					try {
						throwIfMaintenanceAborted();
						throwIfAborted(signal);
						if (!(input instanceof Uint8Array)) throw new TypeError('Media chunks must be Uint8Array values.');
						if (input.byteLength > MEDIA_ASSET_STREAM_CHUNK_BYTES) {
							throw new RangeError('A streamed emission exceeds the fixed 4 MiB media chunk limit.');
						}
						if (input.byteLength > expectedBytes - bytesWritten) {
							throw new RangeError('Streamed media bytes exceed the declared asset size.');
						}
						const snapshot = new Uint8Array(input.byteLength);
						snapshot.set(input);
						await lease.checkpoint();
						throwIfMaintenanceAborted();
						throwIfAborted(signal);
						digest.update(snapshot);
						bytesWritten += snapshot.byteLength;
						let offset = 0;
						while (offset < snapshot.byteLength) {
							const count = Math.min(snapshot.byteLength - offset, pending.byteLength - pendingBytes);
							pending.set(snapshot.subarray(offset, offset + count), pendingBytes);
							pendingBytes += count;
							offset += count;
							if (pendingBytes === pending.byteLength) await flush(signal);
						}
						await lease.checkpoint();
						throwIfMaintenanceAborted();
						throwIfAborted(signal);
					} catch (error) {
						return abortWith(error);
					}
				})();
				activeWrite = operation;
				void operation.then(
					() => { if (activeWrite === operation) activeWrite = null; },
					() => { if (activeWrite === operation) activeWrite = null; },
				);
				return operation;
			},
			commit: (options = {}) => {
				if (state === 'committing' && commitPromise) return commitPromise;
				if (state !== 'open') return Promise.reject(new Error('The streamed media writer is closed.'));
				state = 'committing';
				commitPromise = performCommit(options);
				return commitPromise;
			},
			abort: () => {
				if (maintenanceAbortPromise) return maintenanceAbortPromise;
				if (abortPromise) return abortPromise;
				if (state === 'committing' && commitPromise) {
					abortPromise = commitPromise.then(
						() => undefined,
						() => undefined,
					);
					return abortPromise;
				}
				if (state === 'committed' || state === 'indeterminate') return Promise.resolve();
				if (state === 'aborted') return cleanupPromise ?? Promise.resolve();
				state = 'aborted';
				abortPromise = (async () => {
					try {
						if (activeWrite) {
							try { await activeWrite; } catch { /* Failed write already cleaned its staging sink. */ }
						}
						await cleanup();
					} finally {
						onSettled();
					}
				})();
				return abortPromise;
			},
		};
		const abortForMaintenance = (): Promise<void> => {
			if (maintenanceAbortPromise) return maintenanceAbortPromise;
			if (state === 'committed' || state === 'indeterminate') return Promise.resolve();
			if (publicationStarted && commitPromise) {
				maintenanceAbortPromise = commitPromise.then(
					() => undefined,
					() => undefined,
				);
				return maintenanceAbortPromise;
			}
			maintenanceAborted = true;
			state = 'aborted';
			maintenanceAbortPromise = (async () => {
				let cleanupError: unknown;
				try {
					await cleanup();
				} catch (error) {
					cleanupError = error;
				}
				if (activeWrite) {
					try { await activeWrite; } catch { /* Maintenance cancellation owns the terminal state. */ }
				}
				if (commitPromise) {
					try { await commitPromise; } catch { /* Maintenance cancellation owns the terminal state. */ }
				}
				onSettled();
				if (cleanupError !== undefined) throw cleanupError;
			})();
			return maintenanceAbortPromise;
		};
		return { writer, abortForMaintenance };
	}

	async #assetExists(sourceId: string, database: IDBDatabase | null): Promise<boolean> {
		if (!database) return this.#port.memory.mediaAssets.has(sourceId);
		return transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => (
			request(mediaAssets.get(sourceId)).then(Boolean)
		));
	}

	async #publish(
		record: StorageRecord,
		signal: AbortSignal | undefined,
		database: IDBDatabase | null,
		lease: MediaAssetStagingLease,
	): Promise<void> {
		const sourceId = record.sourceId as string;
		throwIfAborted(signal);
		if (!database) {
			lease.assertInMemory();
			if (this.#port.memory.mediaAssets.has(sourceId)) {
				throw new Error(`Immutable media asset ${sourceId} cannot be overwritten.`);
			}
			throwIfAborted(signal);
			lease.completeInMemory();
			try {
				this.#port.memory.mediaAssets.set(sourceId, clone(record));
			} catch (error) {
				if (await this.#reconcilePublication(record, error, null)) return;
				throw error;
			}
			return;
		}
		let mutationStarted = false;
		try {
			await transact(database, [
				'mediaAssets',
				MEDIA_ASSET_STAGING_STORE_NAME,
			], 'readwrite', async (stores) => {
				const mediaAssets = stores.mediaAssets;
				const staging = stores[MEDIA_ASSET_STAGING_STORE_NAME];
				if (await request(mediaAssets.get(sourceId))) {
					throw new Error(`Immutable media asset ${sourceId} cannot be overwritten.`);
				}
				throwIfAborted(signal);
				await lease.assertInStore(staging);
				throwIfAborted(signal);
				mutationStarted = true;
				await request(mediaAssets.put(record));
				await lease.completeInStore(staging);
			});
		} catch (error) {
			if (!mutationStarted) throw error;
			if (await this.#reconcilePublication(record, error, database)) return;
			throw error;
		}
	}

	async #reconcilePublication(
		record: StorageRecord,
		primary: unknown,
		database: IDBDatabase | null,
	): Promise<boolean> {
		let current: StorageRecord | null;
		try {
			const value = !database
				? this.#port.memory.mediaAssets.get(record.sourceId as string)
				: await transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => (
					request(mediaAssets.get(record.sourceId as string))
				));
			current = storageRecord(value);
		} catch (reconciliationError) {
			throw new MediaPublicationReconciliationError(primary, reconciliationError);
		}
		return sameMediaPayload(current, record);
	}
}

class MediaPublicationReconciliationError extends AggregateError {
	constructor(primary: unknown, reconciliation: unknown) {
		super(
			[primary, reconciliation],
			'Media publication failed and its committed payload could not be reconciled.',
		);
		this.name = 'MediaPublicationReconciliationError';
	}
}

function nonNegativeSafeInteger(value: unknown, message: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(message);
	return number;
}

function nonEmptyString(value: unknown, message: string): string {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) throw new TypeError(message);
	return text;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function hex(bytes: Uint8Array): string {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function clone<Value>(value: Value): Value {
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

function storageRecord(value: unknown): StorageRecord | null {
	return value && typeof value === 'object' ? value as StorageRecord : null;
}

function sameMediaPayload(current: StorageRecord | null, expected: StorageRecord): boolean {
	if (!current || current.sourceId !== expected.sourceId || current.storage !== expected.storage) return false;
	if (typeof expected.mediaChunkToken === 'string') {
		return current.mediaChunkToken === expected.mediaChunkToken;
	}
	return typeof expected.path === 'string' && current.path === expected.path;
}

function isString(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') throw new DOMException('Media storage was cancelled.', 'AbortError');
	const error = new Error('Media storage was cancelled.');
	error.name = 'AbortError';
	throw error;
}
