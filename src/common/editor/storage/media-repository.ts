/* SPDX-License-Identifier: AGPL-3.0-only */

import { deleteByIndex, request, transact } from './indexeddb-backend.ts';
import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
	projectDerivativeCacheInventoryRecord,
	VIDEO_DERIVATIVE_STORE_NAME,
} from './derivative-cache-entry.ts';
import {
	type DerivativeCacheCleanupReport,
	type DerivativeCacheLimits,
} from './derivative-cache-policy.ts';
import { MediaAssetDigestBackfill, type MediaAssetDigestLoadOptions } from './media-asset-digest-backfill.ts';
import { MediaAssetLifecycleCoordinator, type MediaAssetMaintenance } from './media-asset-lifecycle-coordinator.ts';
import { canonicalMediaContentBlob, digestMediaContent } from './media-content-digest.ts';
import { freshVerifiedMediaContentDigest } from './media-content-provenance.ts';
import {
	MediaAssetWriteRepository,
	type MediaAssetWriteOptions,
	type OwnedMediaAssetWriter,
} from './media-asset-write-repository.ts';
import {
	binaryMetadata,
	mediaAssetMetadata,
	type BlobLike,
	type StorageRecord,
} from './media-records.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import {
	VideoDerivativeRepository,
	type VideoDerivativeInput,
	type VideoDerivativeSelector,
} from './video-derivative-repository.ts';

const PENDING_SOURCE_RETENTION_MS = 24 * 60 * 60 * 1000;

interface MediaWriteOptions {
	readonly signal?: AbortSignal;
}

interface MediaRepositoryOptions {
	readonly cacheLimits?: Readonly<Pick<
		DerivativeCacheLimits,
		'maximumBytes' | 'maximumEntries' | 'maximumAgeMs'
	>>;
	readonly now?: () => number;
}
/** Original media containers and replaceable video derivatives. */
export class MediaRepository {
	readonly #port: StorageRepositoryPort;
	readonly #opfs: OpfsRepository;
	readonly #assetLifecycle = new MediaAssetLifecycleCoordinator();
	readonly #assetWrites: MediaAssetWriteRepository;
	readonly #assetDigests: MediaAssetDigestBackfill;
	readonly #derivatives: VideoDerivativeRepository;

	constructor(port: StorageRepositoryPort, opfs: OpfsRepository, options: MediaRepositoryOptions = {}) {
		this.#port = port;
		this.#opfs = opfs;
		this.#assetWrites = new MediaAssetWriteRepository(port, opfs, this.#assetLifecycle);
		this.#assetDigests = new MediaAssetDigestBackfill(port, this.#assetWrites, this.#assetLifecycle);
		this.#derivatives = new VideoDerivativeRepository(port, opfs, options);
	}

	beginAssetWrite(
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
		options: MediaAssetWriteOptions,
	): Promise<OwnedMediaAssetWriter> {
		return this.#assetWrites.begin(sourceId, metadata, options);
	}
	beginAssetMaintenance(options: Readonly<{ permanent?: boolean }> = {}): MediaAssetMaintenance { return this.#assetLifecycle.beginMaintenance(options); }
	activeAssetStaging() { return this.#assetWrites.activeStaging(); }
	invalidateAssetStagingMemory() { return this.#assetWrites.invalidateStagingMemory(); }
	invalidateAssetStagingStore(store: IDBObjectStore) { return this.#assetWrites.invalidateStagingStore(store); }
	async writeAsset(
		sourceId: string,
		input: unknown,
		metadata: Record<string, unknown> = {},
		{ signal }: MediaWriteOptions = {},
	): Promise<Record<string, unknown>> {
		throwIfAborted(signal);
		const id = nonEmptyString(sourceId, 'A media source id is required.');
		const blob = canonicalMediaContentBlob(input);
		const previous = await this.getAssetMetadata(id);
		throwIfAborted(signal);
		if (previous) throw new Error(`Immutable media asset ${id} cannot be overwritten.`);
		const sha256 = (await digestMediaContent(blob, { signal })).toLowerCase();
		throwIfAborted(signal);
		const provenance = freshVerifiedMediaContentDigest(sha256);
		const storedFile = await this.#opfs.writeBlob(`media-${id}`, blob, { signal });
		const record: StorageRecord = {
			...binaryMetadata(metadata),
			sourceId: id,
			...provenance,
			storage: storedFile ? 'opfs' : 'indexeddb-blob',
			path: storedFile?.path,
			blob: storedFile ? undefined : blob,
			size: blob.size,
			mimeType: String(metadata.mimeType || blob.type || ''),
			name: String(metadata.name || fileField(input, 'name') || ''),
			lastModified: nonNegativeInteger(metadata.lastModified ?? fileField(input, 'lastModified'), 0),
			committedAt: new Date().toISOString(),
			pendingProjectUntil: new Date(Date.now() + PENDING_SOURCE_RETENTION_MS).toISOString(),
		};
		try {
			const database = await this.#port.database();
			throwIfAborted(signal);
			if (!database) this.#port.memory.mediaAssets.set(id, clone(record));
			else await transact(database, 'mediaAssets', 'readwrite', ({ mediaAssets }) => { mediaAssets.put(record); });
		} catch (error) {
			if (storedFile) await this.#opfs.deletePath(storedFile.path);
			throw error;
		}
		return mediaAssetMetadata(record);
	}

	loadAsset(sourceId: string, options: MediaAssetDigestLoadOptions = {}): Promise<BlobLike | null> {
		return this.#assetDigests.load(sourceId, options);
	}

	async getAssetMetadata(sourceId: string): Promise<Record<string, unknown> | null> {
		const record = await this.assetRecord(sourceId);
		return record ? mediaAssetMetadata(record) : null;
	}

	async deleteAsset(sourceId: string): Promise<void> {
		const id = nonEmptyString(sourceId, 'A media source id is required.');
		const database = await this.#port.database();
		let record: StorageRecord | null;
		let derivatives: StorageRecord[];
		if (!database) {
			record = clone(asStorageRecord(this.#port.memory.mediaAssets.get(id)));
			derivatives = [...this.#port.memory.videoDerivatives.values()]
				.map(asStorageRecord)
				.filter((candidate): candidate is StorageRecord => candidate?.sourceId === id)
				.map(clone);
			this.#port.memory.mediaAssets.delete(id);
			for (const derivative of derivatives) {
				if (typeof derivative.key === 'string') this.#port.memory.videoDerivatives.delete(derivative.key);
			}
		} else {
			({ record, derivatives } = await transact(
				database,
				['mediaAssets', VIDEO_DERIVATIVE_STORE_NAME, DERIVATIVE_CACHE_ENTRY_STORE_NAME],
				'readwrite',
				async (stores) => {
					const mediaAssets = stores.mediaAssets;
					const videoDerivatives = stores[VIDEO_DERIVATIVE_STORE_NAME];
					const cacheEntries = stores[DERIVATIVE_CACHE_ENTRY_STORE_NAME];
					const storedRecord = await request(mediaAssets.get(id)) as StorageRecord | undefined;
					const storedDerivatives = scalarDerivativeRecords(await request(
						cacheEntries.index(DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME).getAll(id),
					));
					mediaAssets.delete(id);
					await Promise.all([
						deleteByIndex(videoDerivatives.index(DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME), id),
						deleteByIndex(cacheEntries.index(DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME), id),
					]);
					return { record: storedRecord || null, derivatives: storedDerivatives };
				},
			));
		}
		const disposableRecord = record
			? await this.#assetWrites.prepareDetachedPayloadDisposal(record)
			: null;
		await this.#opfs.deleteBinaryRecords([disposableRecord, ...derivatives]);
	}

	cleanupStaleAssetChunks(records: readonly StorageRecord[], cutoff: number, protectedTokens: ReadonlySet<string>): Promise<void> { return this.#assetWrites.cleanupStaleChunks(records, cutoff, protectedTokens); }
	prepareDetachedPayloadDisposal(record: StorageRecord): Promise<StorageRecord | null> { return this.#assetWrites.prepareDetachedPayloadDisposal(record); }

	saveDerivative(
		sourceId: string,
		input: VideoDerivativeInput = {},
	): Promise<Record<string, unknown>> {
		return this.#derivatives.saveDerivative(sourceId, input);
	}

	async trimDerivatives(
		limits: Readonly<DerivativeCacheLimits>,
	): Promise<Readonly<DerivativeCacheCleanupReport>> {
		return this.#derivatives.trimDerivatives(limits);
	}

	async loadDerivative(
		sourceId: string,
		{ timestamp = 0, type, recipe }: VideoDerivativeSelector = {},
	): Promise<BlobLike | null> {
		return this.#derivatives.loadDerivative(sourceId, { timestamp, type, recipe });
	}

	async listDerivatives(
		sourceId: string,
		{ type, recipe }: Pick<VideoDerivativeSelector, 'type' | 'recipe'> = {},
	): Promise<Record<string, unknown>[]> {
		return this.#derivatives.listDerivatives(sourceId, { type, recipe });
	}

	async deleteDerivative(sourceId: string, selector: VideoDerivativeSelector = {}): Promise<void> {
		return this.#derivatives.deleteDerivative(sourceId, selector);
	}

	async assetRecord(sourceId: string): Promise<StorageRecord | null> {
		const database = await this.#port.database();
		const value = !database
			? this.#port.memory.mediaAssets.get(sourceId)
			: await transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => request(mediaAssets.get(sourceId)));
		return clone(asStorageRecord(value));
	}

	async assetRecords(): Promise<StorageRecord[]> {
		const database = await this.#port.database();
		const records = !database
			? [...this.#port.memory.mediaAssets.values()]
			: await transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => request(mediaAssets.getAll()));
		return records.map(asStorageRecord).filter(isStorageRecord).map(clone);
	}

	async derivativeRecord(key: string): Promise<StorageRecord | null> {
		return this.#derivatives.derivativeRecord(key);
	}

	async derivativeRecords(sourceId: string, requestedType: string | null = null): Promise<StorageRecord[]> {
		return this.#derivatives.derivativeRecords(sourceId, requestedType);
	}

	async allDerivativeRecords(): Promise<StorageRecord[]> {
		return this.#derivatives.allDerivativeRecords();
	}
}

function asStorageRecord(value: unknown): StorageRecord | null {
	return value && typeof value === 'object' ? value as StorageRecord : null;
}

function isStorageRecord(value: StorageRecord | null): value is StorageRecord {
	return value !== null;
}

function scalarDerivativeRecords(values: readonly unknown[]): StorageRecord[] {
	return values.map(asStorageRecord).filter(isStorageRecord).map((record) => {
		if (typeof record.key !== 'string') throw new TypeError('A derivative cache record key is required.');
		return projectDerivativeCacheInventoryRecord(record, record.key);
	});
}

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

function fileField(input: unknown, field: 'name' | 'lastModified'): unknown {
	if (!input || typeof input !== 'object' || !(field in input)) return undefined;
	return (input as Record<string, unknown>)[field];
}

function nonNegativeInteger(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback;
}

function nonEmptyString(value: unknown, message: string): string {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) throw new TypeError(message);
	return text;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') throw new DOMException('Media storage was cancelled.', 'AbortError');
	const error = new Error('Media storage was cancelled.');
	error.name = 'AbortError';
	throw error;
}
