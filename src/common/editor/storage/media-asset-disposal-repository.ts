/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	VIDEO_DERIVATIVE_STORE_NAME,
} from './derivative-cache-entry.ts';
import { request, transact } from './indexeddb-backend.ts';
import type { MediaAssetChunkRecords } from './media-asset-chunk-records.ts';
import {
	BINARY_PATH_REFERENCE_INDEX_NAME,
	MEDIA_ASSET_TOKEN_REFERENCE_INDEX_NAME,
} from './media-asset-chunk-schema.ts';
import type { StorageRecord } from './media-records.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

/** Disposes detached originals without following corrupted references into owned payloads. */
export class MediaAssetDisposalRepository {
	readonly #port: StorageRepositoryPort;
	readonly #chunks: MediaAssetChunkRecords;
	readonly #activePaths: () => ReadonlySet<string>;

	constructor(
		port: StorageRepositoryPort,
		chunks: MediaAssetChunkRecords,
		activePaths: () => ReadonlySet<string>,
	) {
		this.#port = port;
		this.#chunks = chunks;
		this.#activePaths = activePaths;
	}

	async prepare(record: StorageRecord): Promise<StorageRecord | null> {
		await this.#deleteChunks(record);
		if (record.storage !== 'opfs' || typeof record.path !== 'string' || !record.path) return record;
		return await this.#hasBinaryPathReference(record.path) ? null : record;
	}

	async #deleteChunks(record: StorageRecord): Promise<void> {
		const token = typeof record.mediaChunkToken === 'string' ? record.mediaChunkToken : '';
		const sourceId = typeof record.sourceId === 'string' ? record.sourceId : '';
		if (!token || !sourceId || await this.#hasMediaReference(MEDIA_ASSET_TOKEN_REFERENCE_INDEX_NAME, token)) return;
		await this.#chunks.deleteOwned(token, sourceId);
	}

	async #hasMediaReference(indexName: string, value: string): Promise<boolean> {
		const database = await this.#port.database();
		if (!database) {
			return [...this.#port.memory.mediaAssets.values()].some((candidate) => (
				storageRecord(candidate)?.[indexName] === value
			));
		}
		return transact(database, 'mediaAssets', 'readonly', ({ mediaAssets }) => (
			request(mediaAssets.index(indexName).count(value)).then((count) => count > 0)
		));
	}

	async #hasBinaryPathReference(path: string): Promise<boolean> {
		if (this.#activePaths().has(path)) return true;
		const database = await this.#port.database();
		if (!database) {
			return [
				this.#port.memory.sources,
				this.#port.memory.mediaAssets,
				this.#port.memory.videoDerivatives,
			].some((records) => [...records.values()].some((candidate) => storageRecord(candidate)?.path === path));
		}
		return transact(database, [
			'sources',
			'mediaAssets',
			VIDEO_DERIVATIVE_STORE_NAME,
			DERIVATIVE_CACHE_ENTRY_STORE_NAME,
		], 'readonly', async (stores) => {
			const counts = await Promise.all(Object.values(stores).map((store) => (
				request(store.index(BINARY_PATH_REFERENCE_INDEX_NAME).count(path))
			)));
			return counts.some((count) => count > 0);
		});
	}
}

function storageRecord(value: unknown): StorageRecord | null {
	return value && typeof value === 'object' ? value as StorageRecord : null;
}
