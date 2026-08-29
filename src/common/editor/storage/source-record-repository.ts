/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	deleteByIndex,
	readCursorPage,
	request,
	transact,
} from './indexeddb-backend.ts';
import {
	cloneChunk,
	sameStoredSourceIdentity,
	type StorageRecord,
} from './media-records.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

const SOURCE_CHUNK_CURSOR_PAGE_SIZE = 8;

export interface SourceChunkRecord extends Record<string, unknown> {
	readonly key: string;
	readonly sourceToken: string;
	readonly index: number;
}

export type DerivedSourcePublicationResult = 'published' | 'base-changed' | 'target-exists';

export type SourceMetadataDeletionResult =
	| { readonly status: 'missing' }
	| { readonly status: 'retained'; readonly dependentSourceId: string }
	| { readonly status: 'deleted'; readonly record: StorageRecord };

/** Metadata and chunk records for immutable PCM sources. */
export class SourceRecordRepository {
	readonly #port: StorageRepositoryPort;

	constructor(port: StorageRepositoryPort) {
		this.#port = port;
	}

	async getMetadata(sourceId: string): Promise<StorageRecord | null> {
		const database = await this.#port.database();
		const value = !database
			? this.#port.memory.sources.get(sourceId)
			: await transact(database, 'sources', 'readonly', ({ sources }) => request(sources.get(sourceId)));
		return value ? clone(value as StorageRecord) : null;
	}

	async list(): Promise<StorageRecord[]> {
		const database = await this.#port.database();
		const values = !database
			? [...this.#port.memory.sources.values()]
			: await transact(database, 'sources', 'readonly', ({ sources }) => request(sources.getAll()));
		return values.map((value) => clone(value as StorageRecord));
	}

	async putMetadata(record: StorageRecord): Promise<void> {
		if (!record.id) throw new TypeError('Source metadata requires an id.');
		const database = await this.#port.database();
		if (!database) this.#port.memory.sources.set(record.id, clone(record));
		else await transact(database, 'sources', 'readwrite', ({ sources }) => { sources.put(record); });
	}

	async putMetadataIfAbsent(record: StorageRecord): Promise<boolean> {
		if (!record.id) throw new TypeError('Source metadata requires an id.');
		const database = await this.#port.database();
		if (!database) {
			if (this.#port.memory.sources.has(record.id)) return false;
			this.#port.memory.sources.set(record.id, clone(record));
			return true;
		}
		return transact(database, 'sources', 'readwrite', async ({ sources }) => {
			if (await request(sources.get(record.id as string)) !== undefined) return false;
			sources.put(record);
			return true;
		});
	}

	async putDerivedMetadataIfBaseCurrent(
		record: StorageRecord,
		expectedBase: StorageRecord,
	): Promise<DerivedSourcePublicationResult> {
		if (!record.id || !expectedBase.id || record.baseSourceId !== expectedBase.id) {
			throw new TypeError('Derived source metadata requires its expected base source identity.');
		}
		const database = await this.#port.database();
		if (!database) {
			const target = this.#port.memory.sources.get(record.id) as StorageRecord | undefined;
			if (target) return 'target-exists';
			const base = this.#port.memory.sources.get(expectedBase.id) as StorageRecord | undefined;
			if (!sameStoredSourceIdentity(base, expectedBase)) return 'base-changed';
			this.#port.memory.sources.set(record.id, clone(record));
			return 'published';
		}
		return transact(database, 'sources', 'readwrite', async ({ sources }) => {
			const [target, base] = await Promise.all([
				request(sources.get(record.id as string)),
				request(sources.get(expectedBase.id as string)),
			]);
			if (target !== undefined) return 'target-exists';
			if (!sameStoredSourceIdentity(base as StorageRecord | undefined, expectedBase)) return 'base-changed';
			sources.put(record);
			return 'published';
		});
	}

	async deleteMetadataIfUnreferenced(sourceId: string): Promise<SourceMetadataDeletionResult> {
		const database = await this.#port.database();
		if (!database) {
			const current = this.#port.memory.sources.get(sourceId) as StorageRecord | undefined;
			if (!current) return { status: 'missing' };
			const dependent = [...this.#port.memory.sources.values()]
				.map((value) => value as StorageRecord)
				.find((candidate) => candidate.baseSourceId === sourceId);
			if (dependent) {
				return { status: 'retained', dependentSourceId: String(dependent.id) };
			}
			this.#port.memory.sources.delete(sourceId);
			return { status: 'deleted', record: clone(current) };
		}
		return transact(database, 'sources', 'readwrite', async ({ sources }) => {
			const [current, dependentSourceId] = await Promise.all([
				request(sources.get(sourceId)),
				findDependentSourceId(sources, sourceId),
			]);
			if (current === undefined) return { status: 'missing' };
			if (dependentSourceId !== null) return { status: 'retained', dependentSourceId };
			sources.delete(sourceId);
			return { status: 'deleted', record: clone(current as StorageRecord) };
		});
	}

	async deleteMetadata(sourceId: string): Promise<void> {
		const database = await this.#port.database();
		if (!database) this.#port.memory.sources.delete(sourceId);
		else await transact(database, 'sources', 'readwrite', ({ sources }) => { sources.delete(sourceId); });
	}

	async deleteMetadataIfCurrent(expected: StorageRecord): Promise<boolean> {
		if (!expected.id) return false;
		const database = await this.#port.database();
		if (!database) {
			const current = this.#port.memory.sources.get(expected.id) as StorageRecord | undefined;
			if (!sameStoredSourceIdentity(current, expected)) return false;
			this.#port.memory.sources.delete(expected.id);
			return true;
		}
		return transact(database, 'sources', 'readwrite', async ({ sources }) => {
			const current = await request(sources.get(expected.id as string)) as StorageRecord | undefined;
			if (!sameStoredSourceIdentity(current, expected)) return false;
			sources.delete(expected.id as string);
			return true;
		});
	}

	async writeChunk(record: SourceChunkRecord): Promise<void> {
		const database = await this.#port.database();
		if (!database) this.#port.memory.sourceChunks.set(record.key, cloneChunk(record));
		else await transact(database, 'sourceChunks', 'readwrite', ({ sourceChunks }) => { sourceChunks.put(record); });
	}

	async *chunks(token: string): AsyncGenerator<SourceChunkRecord> {
		const database = await this.#port.database();
		if (!database) {
			const records = [...this.#port.memory.sourceChunks.values()]
				.map(asChunk)
				.filter((record): record is SourceChunkRecord => record?.sourceToken === token)
				.sort((left, right) => left.index - right.index);
			for (const record of records) yield cloneChunk(record) as SourceChunkRecord;
			return;
		}
		let afterPrimaryKey: IDBValidKey | undefined;
		while (true) {
			const records = await transact(database, 'sourceChunks', 'readonly', ({ sourceChunks }) => (
				readCursorPage<SourceChunkRecord>(sourceChunks.index('sourceToken'), {
					query: token,
					afterPrimaryKey,
					limit: SOURCE_CHUNK_CURSOR_PAGE_SIZE,
				})
			));
			if (!records.length) return;
			afterPrimaryKey = records.at(-1)?.key;
			for (const record of records) yield record;
		}
	}

	async chunk(token: string, index: number): Promise<SourceChunkRecord | null> {
		const key = `${token}:${String(index).padStart(10, '0')}`;
		const database = await this.#port.database();
		const value = !database
			? this.#port.memory.sourceChunks.get(key)
			: await transact(database, 'sourceChunks', 'readonly', ({ sourceChunks }) => request(sourceChunks.get(key)));
		const record = asChunk(value);
		return record ? cloneChunk(record) as SourceChunkRecord : null;
	}

	async deleteChunks(token: string | null | undefined): Promise<void> {
		if (!token) return;
		const database = await this.#port.database();
		if (!database) {
			for (const [key, value] of this.#port.memory.sourceChunks) {
				if (asChunk(value)?.sourceToken === token) this.#port.memory.sourceChunks.delete(key);
			}
			return;
		}
		await transact(database, 'sourceChunks', 'readwrite', ({ sourceChunks }) => (
			deleteByIndex(sourceChunks.index('sourceToken'), token)
		));
	}

	async deleteChunksFrom(token: string, firstIndex: number): Promise<void> {
		const database = await this.#port.database();
		if (!database) {
			for (const [key, value] of this.#port.memory.sourceChunks) {
				const record = asChunk(value);
				if (record?.sourceToken === token && record.index >= firstIndex) {
					this.#port.memory.sourceChunks.delete(key);
				}
			}
			return;
		}
		await transact(database, 'sourceChunks', 'readwrite', ({ sourceChunks }) => (
			deleteChunkTail(sourceChunks.index('sourceToken'), token, firstIndex)
		));
	}

	async cleanupStaleChunks(retainedTokens: ReadonlySet<string>, cutoff: number): Promise<void> {
		const database = await this.#port.database();
		if (!database) {
			for (const [key, value] of this.#port.memory.sourceChunks) {
				const record = asChunk(value);
				if (record && !retainedTokens.has(record.sourceToken) && Number(record.createdAt) < cutoff) {
					this.#port.memory.sourceChunks.delete(key);
				}
			}
			return;
		}
		let afterPrimaryKey: IDBValidKey | undefined;
		while (true) {
			const records = await transact(database, 'sourceChunks', 'readonly', ({ sourceChunks }) => (
				readCursorPage<SourceChunkRecord>(sourceChunks, {
					afterPrimaryKey,
					limit: SOURCE_CHUNK_CURSOR_PAGE_SIZE,
				})
			));
			if (!records.length) return;
			afterPrimaryKey = records.at(-1)?.key;
			const staleKeys = records
				.filter((record) => !retainedTokens.has(record.sourceToken) && Number(record.createdAt) < cutoff)
				.map((record) => record.key);
			if (staleKeys.length) await transact(database, 'sourceChunks', 'readwrite', ({ sourceChunks }) => {
				for (const key of staleKeys) sourceChunks.delete(key);
			});
		}
	}

	async replaceChunkIfCurrent(expectedSource: StorageRecord, record: SourceChunkRecord): Promise<boolean> {
		const database = await this.#port.database();
		if (!database || !expectedSource.id) return false;
		return transact(database, ['sources', 'sourceChunks'], 'readwrite', async ({ sources, sourceChunks }) => {
			const current = await request(sources.get(expectedSource.id as string)) as StorageRecord | undefined;
			if (!sameStoredSourceIdentity(current, expectedSource)) return false;
			sourceChunks.put(record);
			return true;
		});
	}

	async compareAndSwapMetadata(expected: StorageRecord, replacement: StorageRecord): Promise<boolean> {
		if (!expected.id || !replacement.id) return false;
		const database = await this.#port.database();
		if (!database) {
			const current = this.#port.memory.sources.get(expected.id) as StorageRecord | undefined;
			if (!sameStoredSourceIdentity(current, expected)) return false;
			this.#port.memory.sources.set(replacement.id, clone(replacement));
			return true;
		}
		return transact(database, 'sources', 'readwrite', async ({ sources }) => {
			const current = await request(sources.get(expected.id as string)) as StorageRecord | undefined;
			if (!sameStoredSourceIdentity(current, expected)) return false;
			sources.put(replacement);
			return true;
		});
	}
}

function deleteChunkTail(index: IDBIndex, token: string, firstIndex: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const cursorRequest = index.openCursor(token);
		cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Could not enumerate source chunks.'));
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) { resolve(); return; }
			const record = asChunk(cursor.value);
			if (record && record.index >= firstIndex) cursor.delete();
			cursor.continue();
		};
	});
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

function asChunk(value: unknown): SourceChunkRecord | null {
	if (!value || typeof value !== 'object') return null;
	return value as SourceChunkRecord;
}

function clone<Value>(value: Value): Value {
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
