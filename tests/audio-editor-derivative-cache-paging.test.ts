/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import {
	projectDerivativeCacheInventoryRecord,
	readDerivativeCacheInventory,
} from '../src/common/editor/storage/derivative-cache-inventory.ts';
import {
	MAX_INDEXEDDB_CURSOR_PAGE_SIZE,
	openDatabase,
	readCursorPage,
	transact,
} from '../src/common/editor/storage/indexeddb-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

interface CursorStats {
	readonly store: string;
	readonly delivered: number;
	readonly blobValuesDelivered: number;
	readonly blobBytesDelivered: number;
}

interface GetAllStats {
	readonly store: string;
}

interface InstrumentedIndexedDB {
	readonly stats: {
		readonly activeTransactions: number;
		readonly maximumActiveTransactions: number;
		readonly cursorRequests: CursorStats[];
		readonly getAllRequests: GetAllStats[];
		readonly getRequests: readonly unknown[];
	};
	open(name: string, version?: number): IDBOpenDBRequest;
	recordCount(databaseName: string, storeName: string): number;
	seedRecord(databaseName: string, storeName: string, value: unknown): void;
}

test('derivative cache inventory keeps only scalar compare-and-disposal metadata', () => {
	const record = projectDerivativeCacheInventoryRecord({
		key: 'cache-key',
		sourceId: 'source',
		timestamp: 12,
		type: 'poster',
		storage: 'opfs',
		path: 'preview.blob',
		size: 4,
		committedAt: '2026-07-28T00:00:00.000Z',
		cacheToken: 'token',
		blob: new Blob(['data']),
		nestedPayload: { blob: new Blob(['hidden']) },
	}, 'cache-key');

	assert.deepEqual(record, {
		key: 'cache-key',
		sourceId: 'source',
		timestamp: 12,
		type: 'poster',
		storage: 'opfs',
		path: 'preview.blob',
		size: 4,
		committedAt: '2026-07-28T00:00:00.000Z',
		cacheToken: 'token',
	});
	assert.equal((Object.values(record) as unknown[]).some((value) => value instanceof Blob), false);
	const malformed = projectDerivativeCacheInventoryRecord({
		key: 'malformed',
		sourceId: new Blob(['hidden']),
		timestamp: new Blob(['hidden']),
		type: new Blob(['hidden']),
		storage: new Blob(['hidden']),
		path: new Blob(['hidden']),
		size: new Blob(['hidden']),
		committedAt: new Blob(['hidden']),
		cacheToken: new Blob(['hidden']),
	}, 'malformed');
	assert.equal((Object.values(malformed) as unknown[]).some((value) => value instanceof Blob), false);
	assert.equal(malformed.sourceId, undefined);
	assert.equal(malformed.size, undefined);
	assert.throws(
		() => projectDerivativeCacheInventoryRecord({ key: 'redirected' }, 'authoritative'),
		/does not match its cursor primary key/u,
	);
	assert.throws(
		() => projectDerivativeCacheInventoryRecord({ key: 'cache-key' }, 1),
		/cursor primary key is required/u,
	);
});

test('IndexedDB cursor projection has a non-raiseable page cap and closes after projector failure', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('derivative-page-cap');
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	for (let index = 0; index < MAX_INDEXEDDB_CURSOR_PAGE_SIZE + 7; index += 1) {
		indexedDB.seedRecord(databaseName, 'videoDerivatives', cacheRecord(index));
	}

	const page = await transact(database, 'videoDerivatives', 'readonly', ({ videoDerivatives }) => (
		readCursorPage<Readonly<{ key: string; size: number }>>(videoDerivatives, {
			limit: Number.MAX_SAFE_INTEGER,
			project(value, primaryKey) {
				const stored = value as Readonly<{ size: number }>;
				return Object.freeze({ key: String(primaryKey), size: stored.size });
			},
		})
	));

	assert.equal(page.length, MAX_INDEXEDDB_CURSOR_PAGE_SIZE);
	assert.equal(page.some((record) => 'blob' in record), false);
	assert.equal(indexedDB.stats.cursorRequests.at(-1)?.delivered, MAX_INDEXEDDB_CURSOR_PAGE_SIZE);
	const failure = new Error('projection failed');
	await assert.rejects(
		transact(database, 'videoDerivatives', 'readonly', ({ videoDerivatives }) => (
			readCursorPage(videoDerivatives, { project() { throw failure; } })
		)),
		(error: unknown) => error === failure,
	);
	assert.equal(indexedDB.stats.activeTransactions, 0);
	database.close();
});

test('derivative inventory stops at its initial boundary while producers append later keys', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('derivative-moving-tail');
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	const initialRecords = MAX_INDEXEDDB_CURSOR_PAGE_SIZE + 1;
	for (let index = 0; index < initialRecords; index += 1) {
		indexedDB.seedRecord(databaseName, 'videoDerivatives', cacheRecord(index));
	}
	const cursorRequests = indexedDB.stats.cursorRequests;
	const recordRequest = cursorRequests.push.bind(cursorRequests);
	let insertedRecords = 0;
	cursorRequests.push = (...requests: CursorStats[]) => {
		const length = recordRequest(...requests);
		if (requests.some(({ store }) => store === 'videoDerivatives') && insertedRecords < 12) {
			insertedRecords += 1;
			indexedDB.seedRecord(databaseName, 'videoDerivatives', {
				...cacheRecord(10_000 + insertedRecords),
				key: `zz-appended-${String(insertedRecords).padStart(4, '0')}`,
			});
		}
		return length;
	};

	const inventory = await readDerivativeCacheInventory(database);

	assert.equal(inventory.length, initialRecords);
	assert.equal(inventory.some(({ key }) => key.startsWith('zz-appended-')), false);
	assert.ok(insertedRecords <= 3, 'the scan must not chase a producer moving its key tail');
	assert.equal(indexedDB.stats.activeTransactions, 0);
	database.close();
});

test('IndexedDB derivative cleanup inventories large Blob caches in bounded fresh pages', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('derivative-bounded-inventory');
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName,
	});
	await store.ready();
	const recordCount = MAX_INDEXEDDB_CURSOR_PAGE_SIZE * 2 + 3;
	for (let index = 0; index < recordCount; index += 1) {
		indexedDB.seedRecord(databaseName, 'videoDerivatives', cacheRecord(index));
	}

	const report = await store.trimVideoDerivativeCache({ maximumBytes: 0, maximumEntries: 0 });
	const cursors = indexedDB.stats.cursorRequests.filter(({ store: name }) => name === 'videoDerivatives');

	assert.deepEqual(report.before, { bytes: recordCount * 4, entries: recordCount });
	assert.deepEqual(report.after, { bytes: 0, entries: 0 });
	assert.equal(report.removedEntries, recordCount);
	assert.equal(indexedDB.recordCount(databaseName, 'videoDerivatives'), 0);
	assert.equal(indexedDB.stats.getAllRequests.some(({ store: name }) => name === 'videoDerivatives'), false);
	assert.ok(cursors.length >= 3, 'inventory should use multiple fresh cursor transactions');
	assert.ok(cursors.every(({ delivered }) => delivered <= MAX_INDEXEDDB_CURSOR_PAGE_SIZE + 2));
	assert.ok(cursors.every(({ blobValuesDelivered }) => blobValuesDelivered <= MAX_INDEXEDDB_CURSOR_PAGE_SIZE + 2));
	assert.ok(cursors.every(({ blobBytesDelivered }) => blobBytesDelivered <= (MAX_INDEXEDDB_CURSOR_PAGE_SIZE + 2) * 4));
	assert.equal(indexedDB.stats.maximumActiveTransactions, 1);
	assert.equal(indexedDB.stats.activeTransactions, 0);
});

test('corrupt paged derivative accounting fails before cache deletion', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('derivative-corrupt-inventory');
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName,
	});
	await store.ready();
	indexedDB.seedRecord(databaseName, 'videoDerivatives', { ...cacheRecord(0), size: -1 });

	await assert.rejects(
		store.trimVideoDerivativeCache({ maximumBytes: 0, maximumEntries: 0 }),
		/size must be a non-negative safe integer/u,
	);
	assert.equal(indexedDB.recordCount(databaseName, 'videoDerivatives'), 1);
	assert.equal(indexedDB.stats.getRequests.length, 0);
	assert.equal(indexedDB.stats.activeTransactions, 0);
});

function instrumentedIndexedDB(): InstrumentedIndexedDB {
	return createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB;
}

function cacheRecord(index: number): Readonly<Record<string, unknown>> {
	const key = `cache-${String(index).padStart(4, '0')}`;
	return Object.freeze({
		key,
		sourceId: 'source',
		timestamp: index,
		type: 'poster',
		storage: 'indexeddb-blob',
		blob: new Blob(['data']),
		size: 4,
		committedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
		cacheToken: `token-${index}`,
	});
}

function uniqueDatabaseName(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random()}`;
}
