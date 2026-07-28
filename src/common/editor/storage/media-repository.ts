/* SPDX-License-Identifier: AGPL-3.0-only */

import { deleteByIndex, request, transact } from './indexeddb-backend.ts';
import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
	projectDerivativeCacheInventoryRecord,
	VIDEO_DERIVATIVE_STORE_NAME,
} from './derivative-cache-entry.ts';
import {
	DEFAULT_DERIVATIVE_CACHE_LIMITS,
	normalizeDerivativeCacheLimits,
	planDerivativeCacheEviction,
	type DerivativeCacheCleanupReport,
	type DerivativeCacheLimits,
	type DerivativeCacheRecord,
	type NormalizedDerivativeCacheLimits,
} from './derivative-cache-policy.ts';
import { readDerivativeCacheInventory } from './derivative-cache-inventory.ts';
import {
	canonicalMediaContentBlob,
	digestMediaContent,
} from './media-content-digest.ts';
import {
	binaryMetadata,
	mediaAssetMetadata,
	normalizeBlob,
	videoDerivativeIdentity,
	videoDerivativeMetadata,
	type BlobLike,
	type StorageRecord,
} from './media-records.ts';
import type { OpfsRepository } from './opfs-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

const PENDING_SOURCE_RETENTION_MS = 24 * 60 * 60 * 1000;

interface VideoDerivativeInput {
	readonly timestamp?: number;
	readonly type?: string;
	readonly blob?: unknown;
	readonly metadata?: Record<string, unknown>;
}

interface VideoDerivativeSelector {
	readonly timestamp?: number;
	readonly type?: string;
}

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
	readonly #cacheLimits: NormalizedDerivativeCacheLimits;
	readonly #now: () => number;

	constructor(port: StorageRepositoryPort, opfs: OpfsRepository, options: MediaRepositoryOptions = {}) {
		this.#port = port;
		this.#opfs = opfs;
		this.#cacheLimits = normalizeDerivativeCacheLimits(
			options.cacheLimits ?? DEFAULT_DERIVATIVE_CACHE_LIMITS,
		);
		this.#now = options.now ?? Date.now;
	}

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
		const storedFile = await this.#opfs.writeBlob(`media-${id}`, blob, { signal });
		const record: StorageRecord = {
			...binaryMetadata(metadata),
			sourceId: id,
			sha256,
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

	async loadAsset(sourceId: string): Promise<BlobLike | null> {
		const record = await this.assetRecord(sourceId);
		if (!record) return null;
		return this.#opfs.loadBinaryRecord(record, 'The requested local media asset is missing.');
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
		await this.#opfs.deleteBinaryRecords([record, ...derivatives]);
	}

	async saveDerivative(sourceId: string, {
		timestamp = 0,
		type,
		blob: input,
		metadata = {},
	}: VideoDerivativeInput = {}): Promise<Record<string, unknown>> {
		const identity = videoDerivativeIdentity(sourceId, timestamp, type);
		const blob = normalizeBlob(input);
		assertDerivativeFitsCache(blob.size, this.#cacheLimits);
		const database = await this.#port.database();
		let previous: StorageRecord | null = null;
		const storedFile = await this.#opfs.writeBlob(`video-${identity.sourceId}-${identity.type}`, blob);
		let record: StorageRecord;
		let removed: StorageRecord[] = [];
		try {
			const publicationTime = cachePublicationTime(this.#now());
			record = {
				...binaryMetadata(metadata),
				...identity,
				cacheToken: createCacheToken(),
				storage: storedFile ? 'opfs' : 'indexeddb-blob',
				path: storedFile?.path,
				blob: storedFile ? undefined : blob,
				size: blob.size,
				mimeType: String(metadata.mimeType || blob.type || ''),
				committedAt: new Date(publicationTime).toISOString(),
			};
			const incoming = projectDerivativeCacheInventoryRecord(record, identity.key);
			if (!database) {
				previous = clone(asStorageRecord(this.#port.memory.videoDerivatives.get(identity.key)));
				const plan = planDerivativeCachePublication(
					[...this.#port.memory.videoDerivatives.entries()].map(([key, value]) => (
						projectDerivativeCacheInventoryRecord(value, key)
					)),
					incoming,
					this.#cacheLimits,
					publicationTime,
				);
				removed = plan.removals.map((expected) => {
					const key = expected.key as string;
					const current = asStorageRecord(this.#port.memory.videoDerivatives.get(key));
					if (!sameDerivativeCacheRecord(current, expected)) {
						throw new Error(`Derivative cache payload ${key} does not match its eviction metadata.`);
					}
					return projectDerivativeCacheInventoryRecord(current, key);
				});
				this.#port.memory.videoDerivatives.set(identity.key, clone(record));
				for (const candidate of removed) this.#port.memory.videoDerivatives.delete(candidate.key as string);
			} else {
				({ previous, removed } = await transact(
					database,
					[VIDEO_DERIVATIVE_STORE_NAME, DERIVATIVE_CACHE_ENTRY_STORE_NAME],
					'readwrite',
					async (stores) => {
						const videoDerivatives = stores[VIDEO_DERIVATIVE_STORE_NAME];
						const cacheEntries = stores[DERIVATIVE_CACHE_ENTRY_STORE_NAME];
						const [previousEntryValue, previousPayloadValue, cacheValues] = await Promise.all([
							request(cacheEntries.get(identity.key)),
							request(videoDerivatives.get(identity.key)),
							request(cacheEntries.getAll()),
						]);
						const previousEntry = asStorageRecord(previousEntryValue);
						const previousPayload = asStorageRecord(previousPayloadValue);
						if (Boolean(previousEntry) !== Boolean(previousPayload)
							|| (previousEntry && !sameDerivativeCacheRecord(previousPayload, previousEntry))) {
							throw new Error(
								`Derivative cache payload ${identity.key} does not match its replacement metadata.`,
							);
						}
						const plan = planDerivativeCachePublication(
							scalarDerivativeRecords(cacheValues),
							incoming,
							this.#cacheLimits,
							publicationTime,
						);
						const evicted: StorageRecord[] = [];
						for (const expected of plan.removals) {
							const key = expected.key as string;
							const payload = asStorageRecord(await request(videoDerivatives.get(key)));
							if (!sameDerivativeCacheRecord(payload, expected)) {
								throw new Error(`Derivative cache payload ${key} does not match its eviction metadata.`);
							}
							evicted.push(projectDerivativeCacheInventoryRecord(payload, key));
						}
						videoDerivatives.put(record);
						cacheEntries.put(incoming);
						for (const candidate of evicted) {
							const key = candidate.key as string;
							videoDerivatives.delete(key);
							cacheEntries.delete(key);
						}
						return { previous: previousPayload, removed: evicted };
					},
				));
			}
		} catch (error) {
			if (storedFile) await this.#opfs.deletePath(storedFile.path);
			throw error;
		}
		await this.#opfs.deleteBinaryRecords([
			...(previous?.path !== record.path ? [previous] : []),
			...removed,
		].filter((candidate) => candidate?.path !== record.path));
		return videoDerivativeMetadata(record);
	}

	async trimDerivatives(
		limits: Readonly<DerivativeCacheLimits>,
	): Promise<Readonly<DerivativeCacheCleanupReport>> {
		const plan = planDerivativeCacheEviction(await this.allDerivativeRecords(), limits);
		const removed: StorageRecord[] = [];
		if (plan.removals.length) {
			const database = await this.#port.database();
			if (!database) {
				for (const expected of plan.removals) {
					const key = expected.key as string;
					const current = asStorageRecord(this.#port.memory.videoDerivatives.get(key));
					if (!sameDerivativeCacheRecord(current, expected)) continue;
					this.#port.memory.videoDerivatives.delete(key);
					removed.push(projectDerivativeCacheInventoryRecord(current, key));
				}
			} else {
				await transact(
					database,
					[VIDEO_DERIVATIVE_STORE_NAME, DERIVATIVE_CACHE_ENTRY_STORE_NAME],
					'readwrite',
					async (stores) => {
						const videoDerivatives = stores[VIDEO_DERIVATIVE_STORE_NAME];
						const cacheEntries = stores[DERIVATIVE_CACHE_ENTRY_STORE_NAME];
						for (const expected of plan.removals) {
							const key = expected.key as string;
							const [currentEntry, currentPayload] = await Promise.all([
								request(cacheEntries.get(key)).then(asStorageRecord),
								request(videoDerivatives.get(key)).then(asStorageRecord),
							]);
							if (!sameDerivativeCacheRecord(currentEntry, expected)
								|| !sameDerivativeCacheRecord(currentPayload, expected)) continue;
							videoDerivatives.delete(key);
							cacheEntries.delete(key);
							removed.push(projectDerivativeCacheInventoryRecord(currentEntry, key));
						}
					},
				);
			}
			await this.#opfs.deleteBinaryRecords(removed);
		}
		const afterPlan = planDerivativeCacheEviction(await this.allDerivativeRecords(), plan.limits);
		return Object.freeze({
			limits: plan.limits,
			before: plan.before,
			after: afterPlan.before,
			removedBytes: removed.reduce((total, record) => total + Number(record.size), 0),
			removedEntries: removed.length,
			skippedEntries: plan.removals.length - removed.length,
			satisfied: afterPlan.removals.length === 0,
		});
	}

	async loadDerivative(sourceId: string, { timestamp = 0, type }: VideoDerivativeSelector = {}): Promise<BlobLike | null> {
		const identity = videoDerivativeIdentity(sourceId, timestamp, type);
		const record = await this.derivativeRecord(identity.key);
		if (!record) return null;
		return this.#opfs.loadBinaryRecord(record, 'The requested local video derivative is missing.');
	}

	async listDerivatives(sourceId: string, { type }: Pick<VideoDerivativeSelector, 'type'> = {}): Promise<Record<string, unknown>[]> {
		const id = nonEmptyString(sourceId, 'A media source id is required.');
		const requestedType = type === undefined ? null : nonEmptyString(type, 'A video derivative type is required.');
		const records = await this.derivativeRecords(id, requestedType);
		return records
			.filter((record) => requestedType === null || record.type === requestedType)
			.sort((left, right) => Number(left.timestamp) - Number(right.timestamp)
				|| String(left.type).localeCompare(String(right.type)))
			.map(videoDerivativeMetadata);
	}

	async deleteDerivative(sourceId: string, selector: VideoDerivativeSelector = {}): Promise<void> {
		const id = nonEmptyString(sourceId, 'A media source id is required.');
		const hasTimestamp = selector.timestamp !== undefined;
		const hasType = selector.type !== undefined;
		const timestamp = hasTimestamp
			? nonNegativeFiniteNumber(selector.timestamp, 'A non-negative derivative timestamp is required.')
			: null;
		const type = hasType ? nonEmptyString(selector.type, 'A video derivative type is required.') : null;
		const database = await this.#port.database();
		let records: StorageRecord[];
		if (!database) {
			records = [...this.#port.memory.videoDerivatives.values()]
				.map(asStorageRecord)
				.filter(isStorageRecord)
				.filter((record) => record.sourceId === id
					&& (timestamp === null || record.timestamp === timestamp)
					&& (type === null || record.type === type))
				.map(clone);
			for (const record of records) {
				if (typeof record.key === 'string') this.#port.memory.videoDerivatives.delete(record.key);
			}
		} else {
			records = await transact(
				database,
				[VIDEO_DERIVATIVE_STORE_NAME, DERIVATIVE_CACHE_ENTRY_STORE_NAME],
				'readwrite',
				async (stores) => {
					const videoDerivatives = stores[VIDEO_DERIVATIVE_STORE_NAME];
					const cacheEntries = stores[DERIVATIVE_CACHE_ENTRY_STORE_NAME];
					const candidates = scalarDerivativeRecords(await request(
						cacheEntries.index(DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME).getAll(id),
					));
					const selected = candidates.filter((record) => record.sourceId === id
						&& (timestamp === null || record.timestamp === timestamp)
						&& (type === null || record.type === type));
					for (const record of selected) {
						const key = record.key as string;
						videoDerivatives.delete(key);
						cacheEntries.delete(key);
					}
					return selected;
				},
			);
		}
		if (!records.length) return;
		await this.#opfs.deleteBinaryRecords(records);
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
		const database = await this.#port.database();
		const value = !database
			? this.#port.memory.videoDerivatives.get(key)
			: await transact(database, VIDEO_DERIVATIVE_STORE_NAME, 'readonly', (stores) => (
				request(stores[VIDEO_DERIVATIVE_STORE_NAME].get(key))
			));
		return clone(asStorageRecord(value));
	}

	async derivativeRecords(sourceId: string, requestedType: string | null = null): Promise<StorageRecord[]> {
		const database = await this.#port.database();
		let records: unknown[];
		if (!database) {
			records = [...this.#port.memory.videoDerivatives.values()]
				.map(asStorageRecord)
				.filter((record) => record?.sourceId === sourceId
					&& (requestedType === null || record.type === requestedType));
		} else if (requestedType === null) {
			records = await transact(database, VIDEO_DERIVATIVE_STORE_NAME, 'readonly', (stores) => (
				request(stores[VIDEO_DERIVATIVE_STORE_NAME].index(DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME).getAll(sourceId))
			));
		} else {
			records = await transact(
				database,
				[VIDEO_DERIVATIVE_STORE_NAME, DERIVATIVE_CACHE_ENTRY_STORE_NAME],
				'readonly',
				async (stores) => {
					const videoDerivatives = stores[VIDEO_DERIVATIVE_STORE_NAME];
					const cacheEntries = stores[DERIVATIVE_CACHE_ENTRY_STORE_NAME];
					const selected = scalarDerivativeRecords(await request(
						cacheEntries.index(DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME).getAll(sourceId),
					)).filter((record) => record.sourceId === sourceId && record.type === requestedType);
					const payloads = await Promise.all(selected.map((record) => request(
						videoDerivatives.get(record.key as string),
					)));
					return payloads.filter((payload, index) => sameDerivativeCacheRecord(
						asStorageRecord(payload),
						selected[index],
					));
				},
			);
		}
		return records.map(asStorageRecord).filter(isStorageRecord).map(clone);
	}

	async allDerivativeRecords(): Promise<StorageRecord[]> {
		const database = await this.#port.database();
		if (database) return readDerivativeCacheInventory(database);
		return [...this.#port.memory.videoDerivatives.entries()].map(([key, record]) => (
			projectDerivativeCacheInventoryRecord(record, key)
		));
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

function sameDerivativeCacheRecord(
	current: StorageRecord | null,
	expected: Readonly<Record<string, unknown>>,
): current is StorageRecord {
	if (!current || current.key !== expected.key) return false;
	if (typeof current.cacheToken === 'string' || typeof expected.cacheToken === 'string') {
		if (typeof current.cacheToken !== 'string'
			|| current.cacheToken !== expected.cacheToken) return false;
	}
	return current.sourceId === expected.sourceId
		&& current.timestamp === expected.timestamp
		&& current.type === expected.type
		&& current.storage === expected.storage
		&& (current.path || null) === (expected.path || null)
		&& current.size === expected.size
		&& current.committedAt === expected.committedAt;
}

function planDerivativeCachePublication(
	records: readonly Readonly<DerivativeCacheRecord>[],
	incoming: Readonly<DerivativeCacheRecord>,
	limits: NormalizedDerivativeCacheLimits,
	now: number,
) {
	const incomingKey = typeof incoming.key === 'string' ? incoming.key : '';
	if (!incomingKey) throw new TypeError('A derivative cache publication key is required.');
	const candidates = records.filter(({ key }) => key !== incomingKey);
	const plan = planDerivativeCacheEviction([...candidates, incoming], { ...limits, now });
	if (plan.removals.some(({ key }) => key === incomingKey)) {
		throw new RangeError('The derivative cache entry cannot fit within the configured derivative cache limits.');
	}
	return plan;
}

function assertDerivativeFitsCache(size: number, limits: NormalizedDerivativeCacheLimits): void {
	if (!Number.isSafeInteger(size) || size < 0) {
		throw new RangeError('Derivative cache entry size must be a non-negative safe integer.');
	}
	if (limits.maximumEntries === 0
		|| size > limits.maximumBytes
		|| limits.maximumAgeMs === 0) {
		throw new RangeError('The derivative cache entry cannot fit within the configured derivative cache limits.');
	}
}

function cachePublicationTime(value: unknown): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0 || number > 8_640_000_000_000_000) {
		throw new RangeError('The derivative cache publication time is outside the supported Date range.');
	}
	return number;
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

function nonNegativeFiniteNumber(value: unknown, message: string): number {
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0) throw new RangeError(message);
	return number;
}

function nonEmptyString(value: unknown, message: string): string {
	const text = typeof value === 'string' ? value.trim() : '';
	if (!text) throw new TypeError(message);
	return text;
}

function createCacheToken(): string {
	if (globalThis.crypto?.randomUUID) return `cache-${globalThis.crypto.randomUUID()}`;
	return `cache-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') throw new DOMException('Media storage was cancelled.', 'AbortError');
	const error = new Error('Media storage was cancelled.');
	error.name = 'AbortError';
	throw error;
}
