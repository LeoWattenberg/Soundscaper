/* SPDX-License-Identifier: AGPL-3.0-only */

import { deleteByIndex, request, transact } from './indexeddb-backend.ts';
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

/** Original media containers and replaceable video derivatives. */
export class MediaRepository {
	readonly #port: StorageRepositoryPort;
	readonly #opfs: OpfsRepository;

	constructor(port: StorageRepositoryPort, opfs: OpfsRepository) {
		this.#port = port;
		this.#opfs = opfs;
	}

	async writeAsset(
		sourceId: string,
		input: unknown,
		metadata: Record<string, unknown> = {},
	): Promise<Record<string, unknown>> {
		const id = nonEmptyString(sourceId, 'A media source id is required.');
		const blob = normalizeBlob(input);
		if (await this.getAssetMetadata(id)) throw new Error(`Immutable media asset ${id} cannot be overwritten.`);
		const storedFile = await this.#opfs.writeBlob(`media-${id}`, blob);
		const record: StorageRecord = {
			...binaryMetadata(metadata),
			sourceId: id,
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
				['mediaAssets', 'videoDerivatives'],
				'readwrite',
				async ({ mediaAssets, videoDerivatives }) => {
					const storedRecord = await request(mediaAssets.get(id)) as StorageRecord | undefined;
					const storedDerivatives = await request(videoDerivatives.index('sourceId').getAll(id)) as StorageRecord[];
					mediaAssets.delete(id);
					await deleteByIndex(videoDerivatives.index('sourceId'), id);
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
		const previous = await this.derivativeRecord(identity.key);
		const storedFile = await this.#opfs.writeBlob(`video-${identity.sourceId}-${identity.type}`, blob);
		const record: StorageRecord = {
			...binaryMetadata(metadata),
			...identity,
			storage: storedFile ? 'opfs' : 'indexeddb-blob',
			path: storedFile?.path,
			blob: storedFile ? undefined : blob,
			size: blob.size,
			mimeType: String(metadata.mimeType || blob.type || ''),
			committedAt: new Date().toISOString(),
		};
		try {
			const database = await this.#port.database();
			if (!database) this.#port.memory.videoDerivatives.set(identity.key, clone(record));
			else await transact(database, 'videoDerivatives', 'readwrite', ({ videoDerivatives }) => {
				videoDerivatives.put(record);
			});
		} catch (error) {
			if (storedFile) await this.#opfs.deletePath(storedFile.path);
			throw error;
		}
		if (previous?.path !== record.path) await this.#opfs.deleteBinaryRecords([previous]);
		return videoDerivativeMetadata(record);
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
		const records = await this.derivativeRecords(id);
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
		const records = (await this.derivativeRecords(id)).filter((record) => (
			(timestamp === null || record.timestamp === timestamp) && (type === null || record.type === type)
		));
		if (!records.length) return;
		const database = await this.#port.database();
		if (!database) {
			for (const record of records) {
				if (typeof record.key === 'string') this.#port.memory.videoDerivatives.delete(record.key);
			}
		} else {
			await transact(database, 'videoDerivatives', 'readwrite', ({ videoDerivatives }) => {
				for (const record of records) videoDerivatives.delete(record.key as string);
			});
		}
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
			: await transact(database, 'videoDerivatives', 'readonly', ({ videoDerivatives }) => request(videoDerivatives.get(key)));
		return clone(asStorageRecord(value));
	}

	async derivativeRecords(sourceId: string): Promise<StorageRecord[]> {
		const database = await this.#port.database();
		const records = !database
			? [...this.#port.memory.videoDerivatives.values()].map(asStorageRecord).filter((record) => record?.sourceId === sourceId)
			: await transact(database, 'videoDerivatives', 'readonly', ({ videoDerivatives }) => (
				request(videoDerivatives.index('sourceId').getAll(sourceId))
			));
		return records.map(asStorageRecord).filter(isStorageRecord).map(clone);
	}

	async allDerivativeRecords(): Promise<StorageRecord[]> {
		const database = await this.#port.database();
		const records = !database
			? [...this.#port.memory.videoDerivatives.values()]
			: await transact(database, 'videoDerivatives', 'readonly', ({ videoDerivatives }) => request(videoDerivatives.getAll()));
		return records.map(asStorageRecord).filter(isStorageRecord).map(clone);
	}
}

function asStorageRecord(value: unknown): StorageRecord | null {
	return value && typeof value === 'object' ? value as StorageRecord : null;
}

function isStorageRecord(value: StorageRecord | null): value is StorageRecord {
	return value !== null;
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
