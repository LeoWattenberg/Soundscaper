/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	VIDEO_DERIVATIVE_STORE_NAME,
} from './derivative-cache-entry.ts';
import { deleteByIndex, request, transact } from './indexeddb-backend.ts';
import type { StorageRecord } from './media-records.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import { deletePairedVideoDerivativeRecords } from './video-derivative-repository.ts';

const WAVEFORM_PEAK_CACHE_PREFIXES = Object.freeze(['audio-editor-peaks-v1:', 'audio-editor-peaks-v2:']);

export type SourceStorageDeletionResult =
	| { readonly status: 'retained'; readonly dependentSourceId: string }
	| {
		readonly status: 'detached';
		readonly source: StorageRecord | null;
		readonly mediaAsset: StorageRecord | null;
		readonly derivatives: readonly StorageRecord[];
	};

/** Atomically detach one source generation and every by-id payload it currently owns. */
export class SourceDeletionRepository {
	readonly #port: StorageRepositoryPort;

	constructor(port: StorageRepositoryPort) {
		this.#port = port;
	}

	async detachIfUnreferenced(sourceId: string): Promise<SourceStorageDeletionResult> {
		const database = await this.#port.database();
		if (!database) return this.#detachMemory(sourceId);
		return transact(database, [
			'analysis',
			'sources',
			'sourceChunks',
			'mediaAssets',
			VIDEO_DERIVATIVE_STORE_NAME,
			DERIVATIVE_CACHE_ENTRY_STORE_NAME,
		], 'readwrite', async (stores) => {
			const sources = stores.sources;
			const source = asStorageRecord(await request(sources.get(sourceId)));
			if (source) {
				const dependentSourceId = await findDependentSourceId(sources, sourceId);
				if (dependentSourceId !== null) return { status: 'retained', dependentSourceId };
			}
			const [mediaAssetValue, ...waveformValues] = await Promise.all([
				request(stores.mediaAssets.get(sourceId)),
				...WAVEFORM_PEAK_CACHE_PREFIXES.map((prefix) => (
					request(stores.analysis.get(`${prefix}${sourceId}`))
				)),
			]);
			const mediaAsset = asStorageRecord(mediaAssetValue);
			const derivatives = await deletePairedVideoDerivativeRecords(stores, sourceId);
			if (source) {
				sources.delete(sourceId);
				if (source.sourceToken) {
					await deleteByIndex(stores.sourceChunks.index('sourceToken'), source.sourceToken);
				}
			}
			if (mediaAsset) stores.mediaAssets.delete(sourceId);
			for (const [index, value] of waveformValues.entries()) {
				if (value !== undefined) {
					stores.analysis.delete(`${WAVEFORM_PEAK_CACHE_PREFIXES[index]}${sourceId}`);
				}
			}
			return {
				status: 'detached',
				source: clone(source),
				mediaAsset: clone(mediaAsset),
				derivatives: Object.freeze(derivatives.map(clone)),
			};
		});
	}

	#detachMemory(sourceId: string): SourceStorageDeletionResult {
		const memory = this.#port.memory;
		const source = asStorageRecord(memory.sources.get(sourceId));
		if (source) {
			const dependent = [...memory.sources.values()]
				.map(asStorageRecord)
				.find((candidate) => candidate?.baseSourceId === sourceId);
			if (dependent) {
				return { status: 'retained', dependentSourceId: String(dependent.id) };
			}
		}
		const mediaAsset = asStorageRecord(memory.mediaAssets.get(sourceId));
		const derivatives = [...memory.videoDerivatives.values()]
			.map(asStorageRecord)
			.filter((candidate): candidate is StorageRecord => candidate?.sourceId === sourceId);
		if (source) {
			memory.sources.delete(sourceId);
			for (const [key, value] of memory.sourceChunks) {
				if (source.sourceToken && asStorageRecord(value)?.sourceToken === source.sourceToken) {
					memory.sourceChunks.delete(key);
				}
			}
		}
		if (mediaAsset) memory.mediaAssets.delete(sourceId);
		for (const prefix of WAVEFORM_PEAK_CACHE_PREFIXES) {
			memory.analysis.delete(`${prefix}${sourceId}`);
		}
		for (const derivative of derivatives) {
			if (typeof derivative.key === 'string') memory.videoDerivatives.delete(derivative.key);
		}
		return {
			status: 'detached',
			source: clone(source),
			mediaAsset: clone(mediaAsset),
			derivatives: Object.freeze(derivatives.map(clone)),
		};
	}
}

function findDependentSourceId(sources: IDBObjectStore, baseSourceId: string): Promise<string | null> {
	return new Promise((resolve, reject) => {
		const cursorRequest = sources.openCursor();
		cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Could not enumerate source metadata.'));
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) { resolve(null); return; }
			const candidate = cursor.value as StorageRecord;
			if (candidate.baseSourceId === baseSourceId) {
				resolve(String(candidate.id ?? cursor.primaryKey));
				return;
			}
			cursor.continue();
		};
	});
}

function asStorageRecord(value: unknown): StorageRecord | null {
	return value && typeof value === 'object' ? value as StorageRecord : null;
}

function clone<Value>(value: Value): Value {
	if (value === undefined || value === null) return value;
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
