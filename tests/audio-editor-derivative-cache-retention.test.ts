/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	VIDEO_DERIVATIVE_STORE_NAME,
} from '../src/common/editor/storage/derivative-cache-entry.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

interface GetAllStats {
	readonly store: string;
	readonly blobValuesReturned: number;
	readonly blobBytesReturned: number;
}

interface InstrumentedIndexedDB {
	readonly stats: {
		readonly getAllRequests: GetAllStats[];
	};
	open(name: string, version?: number): IDBOpenDBRequest;
	failNextPutForStore(storeName: string, error?: Error): void;
	recordCount(databaseName: string, storeName: string): number;
	records(databaseName: string, storeName: string): Record<string, unknown>[];
	seedRecord(databaseName: string, storeName: string, value: unknown): void;
}

test('clear atomically inventories scalar derivative metadata and clears both cache stores', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('derivative-clear');
	const removals: Array<{ readonly path: string; readonly committed: boolean }> = [];
	const opfsRoot = opfsRootWithRemoval(async (path) => {
		removals.push({
			path,
			committed: indexedDB.recordCount(databaseName, VIDEO_DERIVATIVE_STORE_NAME) === 0
				&& indexedDB.recordCount(databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME) === 0,
		});
	});
	const store = createProjectStore({
		indexedDB: indexedDB as unknown as IDBFactory,
		memoryFallback: false,
		preferOpfs: true,
		opfsRoot,
		databaseName,
	});
	await store.ready();
	seedPair(indexedDB, databaseName, {
		key: 'blob-cache',
		sourceId: 'blob-source',
		storage: 'indexeddb-blob',
		blob: new Blob(['payload-that-must-not-be-read']),
		size: 29,
		committedAt: '2026-01-01T00:00:00.000Z',
	});
	seedPair(indexedDB, databaseName, {
		key: 'opfs-cache',
		sourceId: 'opfs-source',
		storage: 'opfs',
		path: 'opfs-cache.blob',
		blob: new Blob(['hidden-payload']),
		size: 14,
		committedAt: '2026-01-01T00:00:00.000Z',
	});

	await store.clear();

	assert.equal(indexedDB.recordCount(databaseName, VIDEO_DERIVATIVE_STORE_NAME), 0);
	assert.equal(indexedDB.recordCount(databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME), 0);
	assert.deepEqual(removals, [{ path: 'opfs-cache.blob', committed: true }]);
	assertNoDerivativePayloadGetAll(indexedDB);
	assert.deepEqual(
		indexedDB.stats.getAllRequests
			.filter(({ store: storeName }) => storeName === DERIVATIVE_CACHE_ENTRY_STORE_NAME)
			.map(({ blobValuesReturned, blobBytesReturned }) => ({ blobValuesReturned, blobBytesReturned })),
		[{ blobValuesReturned: 0, blobBytesReturned: 0 }],
	);
	await store.close();
});

test('prune derives candidates from scalar metadata and preserves protected payload-entry pairs', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('derivative-prune');
	const removals: Array<{ readonly path: string; readonly synchronized: boolean }> = [];
	const opfsRoot = opfsRootWithRemoval(async (path) => {
		removals.push({
			path,
			synchronized: indexedDB.recordCount(databaseName, VIDEO_DERIVATIVE_STORE_NAME) === 1
				&& indexedDB.recordCount(databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME) === 1,
		});
	});
	const store = createProjectStore({
		indexedDB: indexedDB as unknown as IDBFactory,
		memoryFallback: false,
		preferOpfs: true,
		opfsRoot,
		databaseName,
	});
	await store.ready();
	seedPair(indexedDB, databaseName, {
		key: 'orphan-cache',
		sourceId: 'orphan-source',
		storage: 'opfs',
		path: 'orphan-cache.blob',
		blob: new Blob(['payload-that-must-not-be-read']),
		size: 29,
		committedAt: '2026-01-01T00:00:00.000Z',
	});
	seedPair(indexedDB, databaseName, {
		key: 'protected-cache',
		sourceId: 'protected-source',
		storage: 'indexeddb-blob',
		blob: new Blob(['protected-payload']),
		size: 17,
		committedAt: '2026-01-01T00:00:00.000Z',
	});

	const result = await store.pruneUnreferencedSources({
		protectedSourceIds: ['protected-source'],
		minimumAgeMs: 0,
		now: Date.parse('2026-07-28T00:00:00.000Z'),
	});

	assert.deepEqual(result.deletedSourceIds, ['orphan-source']);
	assert.deepEqual(indexedDB.records(databaseName, VIDEO_DERIVATIVE_STORE_NAME).map(({ key }) => key), ['protected-cache']);
	assert.deepEqual(indexedDB.records(databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME).map(({ key }) => key), ['protected-cache']);
	assert.deepEqual(removals, [{ path: 'orphan-cache.blob', synchronized: true }]);
	assertNoDerivativePayloadGetAll(indexedDB);
	const metadataReads = indexedDB.stats.getAllRequests.filter(
		({ store: storeName }) => storeName === DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	);
	assert.deepEqual(metadataReads.map(({ blobValuesReturned }) => blobValuesReturned), [0]);
	await store.close();
});

test('prune rolls back both derivative stores before OPFS disposal when a later write fails', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('derivative-prune-rollback');
	const removedPaths: string[] = [];
	const store = createProjectStore({
		indexedDB: indexedDB as unknown as IDBFactory,
		memoryFallback: false,
		preferOpfs: true,
		opfsRoot: opfsRootWithRemoval(async (path) => { removedPaths.push(path); }),
		databaseName,
	});
	await store.ready();
	seedPair(indexedDB, databaseName, {
		key: 'rollback-cache',
		sourceId: 'rollback-source',
		storage: 'opfs',
		path: 'rollback-cache.blob',
		size: 8,
		committedAt: '2026-01-01T00:00:00.000Z',
	});
	indexedDB.seedRecord(databaseName, 'projects', {
		id: 'compact-on-prune',
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		sources: [{ id: 'stale-source' }],
		clips: [],
	});
	const plannedFailure = new Error('planned project compaction failure');
	indexedDB.failNextPutForStore('projects', plannedFailure);

	await assert.rejects(
		store.pruneUnreferencedSources({
			minimumAgeMs: 0,
			now: Date.parse('2026-07-28T00:00:00.000Z'),
		}),
	);

	assert.equal(indexedDB.recordCount(databaseName, VIDEO_DERIVATIVE_STORE_NAME), 1);
	assert.equal(indexedDB.recordCount(databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME), 1);
	assert.deepEqual(indexedDB.records(databaseName, 'projects')[0]?.sources, [{ id: 'stale-source' }]);
	assert.deepEqual(removedPaths, []);
	assertNoDerivativePayloadGetAll(indexedDB);
	await store.close();
});

function seedPair(
	indexedDB: InstrumentedIndexedDB,
	databaseName: string,
	payload: Record<string, unknown>,
): void {
	indexedDB.seedRecord(databaseName, VIDEO_DERIVATIVE_STORE_NAME, payload);
	const { blob: _blob, ...metadata } = payload;
	indexedDB.seedRecord(databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME, metadata);
}

function assertNoDerivativePayloadGetAll(indexedDB: InstrumentedIndexedDB): void {
	assert.deepEqual(
		indexedDB.stats.getAllRequests.filter(({ store }) => store === VIDEO_DERIVATIVE_STORE_NAME),
		[],
	);
}

function opfsRootWithRemoval(
	onRemove: (path: string) => Promise<void>,
): FileSystemDirectoryHandle {
	return {
		async getDirectoryHandle() {
			return {
				async removeEntry(path: string) { await onRemove(path); },
			};
		},
	} as unknown as FileSystemDirectoryHandle;
}

function instrumentedIndexedDB(): InstrumentedIndexedDB {
	return createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB;
}

let databaseSequence = 0;

function uniqueDatabaseName(prefix: string): string {
	databaseSequence += 1;
	return `${prefix}-${databaseSequence}`;
}
