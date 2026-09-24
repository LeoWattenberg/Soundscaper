/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectProjectStorageKeys } from '../retention.js';
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
import { MEDIA_ASSET_STAGING_STORE_NAME } from './media-asset-staging-schema.ts';
import {
	revokeSourceStageInMemory,
	revokeSourceStageInStore,
	type MediaAssetStagingLease,
} from './media-asset-staging-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import type { RetentionSessionGuard } from './retention-session-guard.ts';
import {
	findMemoryDependentSourceId,
	findStoredDependentSourceId,
} from './source-dependency-query.ts';

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
	readonly #sessionGuard: RetentionSessionGuard | null;

	constructor(port: StorageRepositoryPort, sessionGuard: RetentionSessionGuard | null = null) {
		this.#port = port;
		this.#sessionGuard = sessionGuard;
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

	/** Publish PCM only while its durable stage is current, consuming the stage atomically. */
	async publishStagedMetadata(
		record: StorageRecord,
		stage: MediaAssetStagingLease,
		ifAbsent: boolean,
		expectedSourceToken?: string,
	): Promise<boolean> {
		if (!record.id) throw new TypeError('Source metadata requires an id.');
		if (!ifAbsent && !expectedSourceToken) throw new TypeError('An expected source generation is required for replacement.');
		const sourceId = record.id;
		const database = await this.#port.database();
		if (!database) {
			stage.assertInMemory();
			const current = this.#port.memory.sources.get(sourceId) as StorageRecord | undefined;
			if (ifAbsent ? current !== undefined : !current || current.sourceToken !== expectedSourceToken) return false;
			if (current && !ifAbsent) {
				if (this.#sessionGuard?.hasOtherMemorySession()) return false;
				if (sourceIsDurablyReferenced(
					sourceId, [...this.#port.memory.projects.values()], [...this.#port.memory.revisions.values()],
				)) return false;
				if (findMemoryDependentSourceId(this.#port.memory.sources, sourceId) !== null) return false;
			}
			const stored = clone(record);
			stage.completeInMemory();
			this.#port.memory.sources.set(sourceId, stored);
			return true;
		}
		if (!ifAbsent) await this.#sessionGuard?.reclaimStoppedSessions(database);
		const storeNames = ifAbsent
			? ['sources', MEDIA_ASSET_STAGING_STORE_NAME]
			: ['projects', 'revisions', 'settings', 'sources', MEDIA_ASSET_STAGING_STORE_NAME];
		return transact(database, storeNames, 'readwrite', async (stores) => {
			const sources = stores.sources;
			const staging = stores[MEDIA_ASSET_STAGING_STORE_NAME];
			await stage.assertInStore(staging);
			const current = await request(sources.get(sourceId)) as StorageRecord | undefined;
			if (ifAbsent ? current !== undefined : !current || current.sourceToken !== expectedSourceToken) return false;
			if (current && !ifAbsent) {
				if (await this.#sessionGuard?.hasOtherOrLostSession(stores.settings)) return false;
				const [projects, revisions] = await Promise.all([
					request(stores.projects.getAll()), request(stores.revisions.getAll()),
				]);
				if (sourceIsDurablyReferenced(sourceId, projects, revisions)) return false;
				if (await findStoredDependentSourceId(sources, sourceId) !== null) return false;
			}
			await request(sources.put(record));
			await stage.completeInStore(staging);
			return true;
		});
	}

	/** Atomically revoke an unpublished source stage before deleting its PCM. */
	async discardUnpublishedStage(sourceId: string, sourceToken: string): Promise<boolean> {
		const database = await this.#port.database();
		if (!database) {
			const memory = this.#port.memory;
			const current = memory.sources.get(sourceId) as StorageRecord | undefined;
			if (current?.sourceToken === sourceToken) return false;
			revokeSourceStageInMemory(memory.mediaAssetStaging, sourceToken);
			for (const [key, value] of memory.sourceChunks) {
				if (asChunk(value)?.sourceToken === sourceToken) memory.sourceChunks.delete(key);
			}
			return true;
		}
		return transact(database, ['sources', 'sourceChunks', MEDIA_ASSET_STAGING_STORE_NAME], 'readwrite', async (stores) => {
			const current = await request(stores.sources.get(sourceId)) as StorageRecord | undefined;
			if (current?.sourceToken === sourceToken) return false;
			await revokeSourceStageInStore(stores[MEDIA_ASSET_STAGING_STORE_NAME], sourceToken);
			await deleteByIndex(stores.sourceChunks.index('sourceToken'), sourceToken);
			return true;
		});
	}

	async putDerivedMetadataIfBaseCurrent(
		record: StorageRecord,
		expectedBase: StorageRecord,
		expectedDependencies: readonly StorageRecord[] = [expectedBase],
	): Promise<DerivedSourcePublicationResult> {
		if (!record.id || !expectedBase.id || expectedDependencies[0]?.id !== expectedBase.id
			|| record.baseSourceId !== expectedDependencies.at(-1)?.id) {
			throw new TypeError('Derived source metadata requires its expected base source identity.');
		}
		const database = await this.#port.database();
		if (!database) {
			const target = this.#port.memory.sources.get(record.id) as StorageRecord | undefined;
			if (target) return 'target-exists';
			for (const expected of expectedDependencies) {
				const current = this.#port.memory.sources.get(expected.id as string) as StorageRecord | undefined;
				if (!sameStoredSourceIdentity(current, expected)) return 'base-changed';
			}
			this.#port.memory.sources.set(record.id, clone(record));
			return 'published';
		}
		return transact(database, 'sources', 'readwrite', async ({ sources }) => {
			const [target, ...dependencies] = await Promise.all([
				request(sources.get(record.id as string)),
				...expectedDependencies.map((expected) => request(sources.get(expected.id as string))),
			]);
			if (target !== undefined) return 'target-exists';
			if (dependencies.some((current, index) => !sameStoredSourceIdentity(
				current as StorageRecord | undefined, expectedDependencies[index],
			))) return 'base-changed';
			sources.put(record);
			return 'published';
		});
	}

	async deleteMetadataIfUnreferenced(sourceId: string): Promise<SourceMetadataDeletionResult> {
		const database = await this.#port.database();
		if (!database) {
			const current = this.#port.memory.sources.get(sourceId) as StorageRecord | undefined;
			if (!current) return { status: 'missing' };
			const dependentSourceId = findMemoryDependentSourceId(this.#port.memory.sources, sourceId);
			if (dependentSourceId !== null) {
				return { status: 'retained', dependentSourceId };
			}
			this.#port.memory.sources.delete(sourceId);
			return { status: 'deleted', record: clone(current) };
		}
		return transact(database, 'sources', 'readwrite', async ({ sources }) => {
			const [current, dependentSourceId] = await Promise.all([
				request(sources.get(sourceId)),
				findStoredDependentSourceId(sources, sourceId),
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
		const sourceId = expected.id;
		const database = await this.#port.database();
		if (!database) {
			const memory = this.#port.memory;
			const current = memory.sources.get(sourceId) as StorageRecord | undefined;
			if (!sameStoredSourceIdentity(current, expected)) return false;
			if (this.#sessionGuard?.hasOtherMemorySession()) {
				throw new Error(`Source ${sourceId} is retained by another open editor session.`);
			}
			if (sourceIsDurablyReferenced(sourceId, [...memory.projects.values()], [...memory.revisions.values()])) {
				throw new Error(`Source ${sourceId} is retained by a saved project or revision.`);
			}
			const dependent = findMemoryDependentSourceId(memory.sources, sourceId);
			if (dependent !== null) throw new Error(`Source ${sourceId} is retained by derived source ${dependent}.`);
			memory.sources.delete(sourceId);
			return true;
		}
		await this.#sessionGuard?.reclaimStoppedSessions(database);
		return transact(database, ['projects', 'revisions', 'settings', 'sources'], 'readwrite', async (stores) => {
			const { sources } = stores;
			const current = await request(sources.get(sourceId)) as StorageRecord | undefined;
			if (!sameStoredSourceIdentity(current, expected)) return false;
			if (await this.#sessionGuard?.hasOtherOrLostSession(stores.settings)) {
				throw new Error(`Source ${sourceId} is retained by another open editor session.`);
			}
			const [projects, revisions, dependent] = await Promise.all([
				request(stores.projects.getAll()), request(stores.revisions.getAll()),
				findStoredDependentSourceId(sources, sourceId),
			]);
			if (sourceIsDurablyReferenced(sourceId, projects, revisions)) {
				throw new Error(`Source ${sourceId} is retained by a saved project or revision.`);
			}
			if (dependent !== null) throw new Error(`Source ${sourceId} is retained by derived source ${dependent}.`);
			sources.delete(sourceId);
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
		if (expected.id !== replacement.id) throw new TypeError('Source metadata cannot change its id.');
		const sourceId = expected.id;
		const changesGeneration = !sameStoredSourceIdentity(expected, replacement);
		const database = await this.#port.database();
		if (!database) {
			const memory = this.#port.memory;
			const current = memory.sources.get(sourceId) as StorageRecord | undefined;
			if (!sameStoredSourceIdentity(current, expected)) return false;
			if (changesGeneration) {
				if (this.#sessionGuard?.hasOtherMemorySession()) {
					throw new Error(`Source ${sourceId} is retained by another open editor session.`);
				}
				if (sourceIsDurablyReferenced(sourceId, [...memory.projects.values()], [...memory.revisions.values()])) {
					throw new Error(`Source ${sourceId} is retained by a saved project or revision.`);
				}
				const dependent = findMemoryDependentSourceId(memory.sources, sourceId);
				if (dependent !== null) throw new Error(`Source ${sourceId} is retained by derived source ${dependent}.`);
			}
			memory.sources.set(sourceId, clone(replacement));
			return true;
		}
		if (changesGeneration) await this.#sessionGuard?.reclaimStoppedSessions(database);
		const stores = changesGeneration ? ['projects', 'revisions', 'settings', 'sources'] : ['sources'];
		return transact(database, stores, 'readwrite', async (transactionStores) => {
			const { sources } = transactionStores;
			const current = await request(sources.get(sourceId)) as StorageRecord | undefined;
			if (!sameStoredSourceIdentity(current, expected)) return false;
			if (changesGeneration) {
				if (await this.#sessionGuard?.hasOtherOrLostSession(transactionStores.settings)) {
					throw new Error(`Source ${sourceId} is retained by another open editor session.`);
				}
				const [projects, revisions, dependent] = await Promise.all([
					request(transactionStores.projects.getAll()), request(transactionStores.revisions.getAll()),
					findStoredDependentSourceId(sources, sourceId),
				]);
				if (sourceIsDurablyReferenced(sourceId, projects, revisions)) {
					throw new Error(`Source ${sourceId} is retained by a saved project or revision.`);
				}
				if (dependent !== null) throw new Error(`Source ${sourceId} is retained by derived source ${dependent}.`);
			}
			sources.put(replacement);
			return true;
		});
	}
}

function sourceIsDurablyReferenced(sourceId: string, projects: unknown[], revisions: unknown[]): boolean {
	const retained = new Set<string>();
	for (const project of projects) collectProjectStorageKeys(project, retained);
	for (const revision of revisions) {
		const record = revision && typeof revision === 'object'
			? revision as Readonly<{ project?: unknown }> : null;
		collectProjectStorageKeys(record?.project, retained);
	}
	return retained.has(sourceId);
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

function asChunk(value: unknown): SourceChunkRecord | null {
	if (!value || typeof value !== 'object') return null;
	return value as SourceChunkRecord;
}

function clone<Value>(value: Value): Value {
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}
