/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	deleteByIndex,
	readCursorPage,
	request,
	transact,
} from './indexeddb-backend.ts';
import { canonicalMediaContentBlob } from './media-content-digest.ts';
import {
	MEDIA_ASSET_CHUNK_STORE_NAME,
	MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME,
} from './media-asset-chunk-schema.ts';
import type { MediaAssetStagingLease } from './media-asset-staging-repository.ts';
import { MEDIA_ASSET_STAGING_STORE_NAME } from './media-asset-staging-schema.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

export { MEDIA_ASSET_CHUNK_STORE_NAME, MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME };

const MEDIA_ASSET_CHUNK_CURSOR_PAGE_SIZE = 1;

export interface MediaAssetChunkRecord extends Record<string, unknown> {
	readonly key: string;
	readonly sourceId: string;
	readonly mediaChunkToken: string;
	readonly index: number;
	readonly payload: Blob;
	readonly byteLength: number;
	readonly createdAt: number;
}

export interface MediaAssetChunkRead {
	readonly primaryKey: IDBValidKey;
	readonly value: unknown;
}

/** Dedicated fallback records for staged immutable media containers. */
export class MediaAssetChunkRecords {
	readonly #port: StorageRepositoryPort;

	constructor(port: StorageRepositoryPort) {
		this.#port = port;
	}

	async write(
		record: MediaAssetChunkRecord,
		capturedDatabase?: IDBDatabase | null,
		lease?: MediaAssetStagingLease,
	): Promise<void> {
		const database = capturedDatabase === undefined
			? await this.#port.database()
			: capturedDatabase;
		if (!database) {
			lease?.assertInMemory({ renew: true });
			this.#port.memory.mediaAssetChunks.set(record.key, cloneChunk(record));
			return;
		}
		const storeNames = lease
			? [MEDIA_ASSET_CHUNK_STORE_NAME, MEDIA_ASSET_STAGING_STORE_NAME]
			: [MEDIA_ASSET_CHUNK_STORE_NAME];
		await transact(database, storeNames, 'readwrite', async (stores) => {
			if (lease) await lease.assertInStore(stores[MEDIA_ASSET_STAGING_STORE_NAME], { renew: true });
			await request(stores[MEDIA_ASSET_CHUNK_STORE_NAME].put(record));
		});
	}

	async *chunks(token: string): AsyncGenerator<MediaAssetChunkRead> {
		const database = await this.#port.database();
		if (!database) {
			const count = [...this.#port.memory.mediaAssetChunks.values()]
				.filter((record) => mediaChunkToken(record) === token)
				.length;
			for (let index = 0; index < count; index += 1) {
				const primaryKey = mediaAssetChunkKey(token, index);
				yield {
					primaryKey,
					value: cloneValue(this.#port.memory.mediaAssetChunks.get(primaryKey)),
				};
			}
			return;
		}
		const count = await transact(database, MEDIA_ASSET_CHUNK_STORE_NAME, 'readonly', (stores) => (
			request(stores[MEDIA_ASSET_CHUNK_STORE_NAME]
				.index(MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME)
				.count(token))
		));
		for (let index = 0; index < count; index += 1) {
			const primaryKey = mediaAssetChunkKey(token, index);
			const value = await transact(database, MEDIA_ASSET_CHUNK_STORE_NAME, 'readonly', (stores) => (
				request(stores[MEDIA_ASSET_CHUNK_STORE_NAME].get(primaryKey))
			));
			yield { primaryKey, value };
		}
	}

	async delete(
		token: string | null | undefined,
		capturedDatabase?: IDBDatabase | null,
	): Promise<void> {
		if (!token) return;
		const database = capturedDatabase === undefined
			? await this.#port.database()
			: capturedDatabase;
		if (!database) {
			for (const [key, value] of this.#port.memory.mediaAssetChunks) {
				if (mediaChunkToken(value) === token) this.#port.memory.mediaAssetChunks.delete(key);
			}
			return;
		}
		await transact(database, MEDIA_ASSET_CHUNK_STORE_NAME, 'readwrite', (stores) => (
			deleteByIndex(
				stores[MEDIA_ASSET_CHUNK_STORE_NAME].index(MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME),
				token,
			)
		));
	}

	async deleteOwned(token: string, sourceId: string): Promise<boolean> {
		const database = await this.#port.database();
		if (!database) {
			const matches = [...this.#port.memory.mediaAssetChunks.entries()]
				.filter(([, value]) => mediaChunkToken(value) === token);
			if (matches.some(([, value]) => mediaAssetChunkRecord(value)?.sourceId !== sourceId)) return false;
			for (const [key] of matches) this.#port.memory.mediaAssetChunks.delete(key);
			return true;
		}
		try {
			await transact(database, MEDIA_ASSET_CHUNK_STORE_NAME, 'readwrite', (stores) => (
				deleteOwnedChunks(
					stores[MEDIA_ASSET_CHUNK_STORE_NAME].index(MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME),
					token,
					sourceId,
				)
			));
			return true;
		} catch (error) {
			if (error instanceof MediaAssetChunkOwnershipError) return false;
			throw error;
		}
	}

	async deleteTailOwned(token: string, sourceId: string, firstIndex: number): Promise<boolean> {
		const database = await this.#port.database();
		if (!database) {
			const matches = [...this.#port.memory.mediaAssetChunks.entries()].filter(([, value]) => {
				const record = mediaAssetChunkRecord(value);
				return record?.mediaChunkToken === token && record.index >= firstIndex;
			});
			if (matches.some(([, value]) => mediaAssetChunkRecord(value)?.sourceId !== sourceId)) return false;
			for (const [key] of matches) this.#port.memory.mediaAssetChunks.delete(key);
			return true;
		}
		try {
			await transact(database, MEDIA_ASSET_CHUNK_STORE_NAME, 'readwrite', (stores) => (
				deleteOwnedChunkTail(
					stores[MEDIA_ASSET_CHUNK_STORE_NAME].index(MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME),
					token, sourceId, firstIndex,
				)
			));
			return true;
		} catch (error) {
			if (error instanceof MediaAssetChunkOwnershipError) return false;
			throw error;
		}
	}

	async cleanupStale(retainedTokens: ReadonlySet<string>, cutoff: number): Promise<void> {
		const database = await this.#port.database();
		if (!database) {
			for (const [key, value] of this.#port.memory.mediaAssetChunks) {
				if (isStaleUnretainedChunk(value, retainedTokens, cutoff)) {
					this.#port.memory.mediaAssetChunks.delete(key);
				}
			}
			return;
		}
		let afterPrimaryKey: IDBValidKey | undefined;
		while (true) {
			const records = await transact(database, MEDIA_ASSET_CHUNK_STORE_NAME, 'readonly', (stores) => (
				readCursorPage<MediaAssetChunkRead>(stores[MEDIA_ASSET_CHUNK_STORE_NAME], {
					afterPrimaryKey,
					limit: MEDIA_ASSET_CHUNK_CURSOR_PAGE_SIZE,
					project: (value, primaryKey) => ({ value, primaryKey }),
				})
			));
			if (!records.length) return;
			afterPrimaryKey = records.at(-1)?.primaryKey;
			const stale = records.filter(({ value }) => isStaleUnretainedChunk(value, retainedTokens, cutoff));
			if (stale.length) await transact(database, MEDIA_ASSET_CHUNK_STORE_NAME, 'readwrite', (stores) => {
				for (const record of stale) stores[MEDIA_ASSET_CHUNK_STORE_NAME].delete(record.primaryKey);
			});
		}
	}
}

class MediaAssetChunkOwnershipError extends Error {}

function deleteOwnedChunks(index: IDBIndex, token: string, sourceId: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const cursorRequest = index.openCursor(token);
		cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Could not enumerate media chunks.'));
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) {
				resolve();
				return;
			}
			const record = mediaAssetChunkRecord(cursor.value);
			if (!record || record.sourceId !== sourceId) {
				reject(new MediaAssetChunkOwnershipError('Media chunk ownership does not match its metadata.'));
				return;
			}
			cursor.delete();
			cursor.continue();
		};
	});
}

function deleteOwnedChunkTail(index: IDBIndex, token: string, sourceId: string, firstIndex: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const cursorRequest = index.openCursor(token);
		cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Could not enumerate media chunks.'));
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) { resolve(); return; }
			const record = mediaAssetChunkRecord(cursor.value);
			if (record && record.index < firstIndex) { cursor.continue(); return; }
			if (!record || record.sourceId !== sourceId) {
				reject(new MediaAssetChunkOwnershipError('Media chunk ownership does not match its metadata.'));
				return;
			}
			cursor.delete();
			cursor.continue();
		};
	});
}

export function mediaAssetChunkKey(token: string, index: number): string {
	return `${token}:${String(index).padStart(10, '0')}`;
}

export function mediaAssetChunkRecord(value: unknown): MediaAssetChunkRecord | null {
	if (!value || typeof value !== 'object') return null;
	const record = value as Partial<MediaAssetChunkRecord>;
	let payload: Blob;
	try {
		payload = canonicalMediaContentBlob(record.payload);
	} catch {
		return null;
	}
	if (typeof record.key !== 'string'
		|| typeof record.sourceId !== 'string'
		|| record.sourceId.length < 1
		|| typeof record.mediaChunkToken !== 'string'
		|| !Number.isSafeInteger(record.index)
		|| Number(record.index) < 0
		|| !Number.isSafeInteger(record.byteLength)
		|| record.byteLength !== payload.size
		|| !Number.isFinite(record.createdAt)) return null;
	return { ...record, payload } as MediaAssetChunkRecord;
}

function cloneChunk(record: MediaAssetChunkRecord): MediaAssetChunkRecord {
	return { ...record };
}

function cloneValue(value: unknown): unknown {
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return value;
}

function mediaChunkToken(value: unknown): unknown {
	return value && typeof value === 'object' ? (value as Record<string, unknown>).mediaChunkToken : undefined;
}

function mediaChunkCreatedAt(value: unknown): number {
	const createdAt = value && typeof value === 'object' ? (value as Record<string, unknown>).createdAt : NaN;
	return Number(createdAt);
}

function isStaleUnretainedChunk(
	value: unknown,
	retainedTokens: ReadonlySet<string>,
	cutoff: number,
): boolean {
	const token = mediaChunkToken(value);
	if (typeof token !== 'string' || !token) return true;
	if (retainedTokens.has(token)) return false;
	const createdAt = mediaChunkCreatedAt(value);
	return !Number.isFinite(createdAt) || createdAt < cutoff;
}
