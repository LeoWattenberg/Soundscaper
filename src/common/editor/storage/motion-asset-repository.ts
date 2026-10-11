/* SPDX-License-Identifier: AGPL-3.0-only */

import { createScapeDigest, scapeHex } from '../scape-archive-media.ts';
import { throwIfScapeAborted } from '../scape-abort.ts';
import { normalizeMotionAsset, type MotionAsset } from '../motion-asset.ts';
import type { MotionAssetBody } from '../motion-asset-body.ts';
import { SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES } from '../scape-export-estimate.ts';
import { aggregateScapeErrors } from '../scape-abort.ts';
import { deleteByIndex, request, transact } from './indexeddb-backend.ts';
import { discardMotionAssetStage, motionAssetStageRecord, renewMotionAssetStage } from './motion-asset-staging.ts';

export const MOTION_ASSET_CHUNK_BYTES = 4 * 1024 * 1024;

interface AssetBodyRecord {
	readonly key: string; readonly sha256: string; readonly byteLength: number;
	readonly token: string; readonly chunkCount: number;
}
interface ChunkRecord { readonly key: string; readonly token: string; readonly bytes: Uint8Array }
export interface MotionAssetStaging {
	readonly asset: MotionAsset;
	write(bytes: Uint8Array): Promise<void>;
	finish(): Promise<void>;
	publish(stores: Record<string, IDBObjectStore>): Promise<void>;
	rollback(): Promise<void>;
}

/** Content-addressed bodies are immutable. Chunks and staging are private until atomic publication. */
export class MotionAssetRepository {
	readonly #database: () => Promise<IDBDatabase>;

	constructor(database: () => Promise<IDBDatabase>) { this.#database = database; }

	async stage(value: unknown): Promise<MotionAssetStaging> {
		const asset = normalizeMotionAsset(value);
		const database = await this.#database();
		const token = crypto.randomUUID();
		const digest = createScapeDigest();
		let size = 0;
		let chunks = 0;
		let finished = false;
		let rolledBack = false;
		let writing = false;
		await transact(database, ['staging'], 'readwrite', async (stores) => {
			await request(stores.staging.add(motionAssetStageRecord(token, asset)));
		});
		return {
			asset,
			async write(bytes) {
				if (finished || rolledBack) throw new Error('Motion asset staging is closed.');
				if (writing) throw new Error('Motion asset staging writes must be sequential.');
				if (!(bytes instanceof Uint8Array) || bytes.byteLength > asset.byteLength - size) {
					throw new RangeError('Motion asset staging exceeds its declared size.');
				}
				writing = true;
				try {
					for (let offset = 0; offset < bytes.byteLength; offset += MOTION_ASSET_CHUNK_BYTES) {
						const chunk = bytes.slice(offset, offset + MOTION_ASSET_CHUNK_BYTES);
						const record = { key: chunkKey(token, chunks), token, bytes: chunk };
						await transact(database, ['chunks', 'staging'], 'readwrite', async (stores) => {
							await renewMotionAssetStage(stores, token, asset);
							await request(stores.chunks.add(record));
						});
						digest.update(chunk);
						chunks += 1;
						size += chunk.byteLength;
					}
				} finally { writing = false; }
			},
			async finish() {
				if (finished || rolledBack || writing) throw new Error('Motion asset staging is closed or still writing.');
				if (size !== asset.byteLength || scapeHex(digest.digest()) !== asset.sha256) {
					throw new RangeError('Motion asset staging digest or size does not match its contract.');
				}
				await transact(database, ['staging'], 'readwrite', async (stores) => { await renewMotionAssetStage(stores, token, asset); });
				finished = true;
			},
			async publish(stores) {
				if (!finished || rolledBack) throw new Error('Motion asset must be verified before publication.');
				await renewMotionAssetStage(stores, token, asset);
				const existing: unknown = await request(stores.assets.get(asset.storageKey));
				if (existing !== undefined) {
					assertBodyRecord(existing, asset);
					await deleteByIndex(stores.chunks.index('token'), token);
				} else {
					await request(stores.assets.put({ key: asset.storageKey, sha256: asset.sha256,
						byteLength: asset.byteLength, token, chunkCount: chunks } satisfies AssetBodyRecord));
				}
				await request(stores.staging.delete(token));
			},
			async rollback() {
				if (rolledBack) return;
				await transact(database, ['chunks', 'staging', 'assets'], 'readwrite', async (stores) => { await discardMotionAssetStage(stores, token); });
				rolledBack = true;
			},
		};
	}

	async assertAvailable(stores: Record<string, IDBObjectStore>, asset: MotionAsset): Promise<void> {
		const record: unknown = await request(stores.assets.get(asset.storageKey));
		if (record === undefined) throw new Error(`Motion asset ${asset.id} is unavailable.`);
		assertBodyRecord(record, asset);
	}

	async put(value: unknown, body: Blob, signal?: AbortSignal): Promise<void> {
		throwIfScapeAborted(signal);
		const staging = await this.stage(value);
		try {
			if (!(body instanceof Blob) || body.size !== staging.asset.byteLength) throw new RangeError('Motion asset body size changed.');
			const reader = body.stream().getReader();
			try {
				while (true) {
					throwIfScapeAborted(signal);
					const { done, value: bytes } = await reader.read();
					if (done) break;
					await staging.write(bytes);
				}
			} finally { await reader.cancel(); reader.releaseLock(); }
			throwIfScapeAborted(signal);
			await staging.finish();
			const database = await this.#database();
			await transact(database, ['assets', 'chunks', 'staging'], 'readwrite', async (stores) => {
				throwIfScapeAborted(signal);
				await staging.publish(stores);
			});
		} catch (error) {
			try { await staging.rollback(); }
			catch (cleanup) { throw aggregateScapeErrors(error, [cleanup], 'Motion asset write and rollback failed.'); }
			throw error;
		}
	}

	async load(value: unknown): Promise<Blob | null> {
		const asset = normalizeMotionAsset(value);
		if (asset.byteLength > SCAPE_WEB_CORE_BLOB_MAXIMUM_BYTES) {
			throw new RangeError('Motion asset exceeds Blob memory admission; use its streaming reader.');
		}
		const body = await this.read(asset);
		return body ? new Response(body.stream()).blob() : null;
	}

	async read(value: unknown): Promise<MotionAssetBody | null> {
		const asset = normalizeMotionAsset(value);
		const database = await this.#database();
		const record: unknown = await transact(database, ['assets'], 'readonly', (stores) => request(stores.assets.get(asset.storageKey)));
		if (record === undefined) return null;
		assertBodyRecord(record, asset);
		return Object.freeze({ size: asset.byteLength, stream: () => assetStream(database, record, asset) });
	}
}

function assetStream(database: IDBDatabase, record: AssetBodyRecord, asset: MotionAsset): ReadableStream<Uint8Array> {
	const digest = createScapeDigest();
	let size = 0;
	let index = 0;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (index === record.chunkCount) {
				if (size !== asset.byteLength || scapeHex(digest.digest()) !== asset.sha256) {
					throw new RangeError('Stored motion asset digest is corrupt.');
				}
				controller.close();
				return;
			}
			const chunk: unknown = await transact(database, ['chunks'], 'readonly', (stores) => request(stores.chunks.get(chunkKey(record.token, index))));
			if (!isChunk(chunk) || chunk.key !== chunkKey(record.token, index) || chunk.token !== record.token
				|| chunk.bytes.byteLength === 0 || chunk.bytes.byteLength > MOTION_ASSET_CHUNK_BYTES
				|| chunk.bytes.byteLength > asset.byteLength - size) throw new Error('Motion asset has a corrupt or missing storage chunk.');
			digest.update(chunk.bytes);
			size += chunk.bytes.byteLength;
			index += 1;
			controller.enqueue(chunk.bytes);
		},
	}, { highWaterMark: 0 });
}

function chunkKey(token: string, index: number): string { return `${token}:${String(index).padStart(12, '0')}`; }

function assertBodyRecord(value: unknown, asset: MotionAsset): asserts value is AssetBodyRecord {
	const record = value as Partial<AssetBodyRecord> | null;
	if (!record || record.key !== asset.storageKey || record.sha256 !== asset.sha256
		|| record.byteLength !== asset.byteLength || typeof record.token !== 'string'
		|| !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(record.token)
		|| !Number.isSafeInteger(record.chunkCount) || Number(record.chunkCount) < 1
		|| Number(record.chunkCount) > asset.byteLength) {
		throw new RangeError('Stored motion asset does not match its contract.');
	}
}

function isChunk(value: unknown): value is ChunkRecord {
	if (!value || typeof value !== 'object') return false;
	const record = value as Partial<ChunkRecord>;
	return typeof record.key === 'string' && typeof record.token === 'string' && record.bytes instanceof Uint8Array;
}
