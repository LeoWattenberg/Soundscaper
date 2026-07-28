/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
	VIDEO_DERIVATIVE_STORE_NAME,
} from '../src/common/editor/storage/derivative-cache-entry.ts';
import { readDerivativeCacheInventory } from '../src/common/editor/storage/derivative-cache-inventory.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import {
	BINARY_PATH_REFERENCE_INDEX_NAME,
	MEDIA_ASSET_CHUNK_STORE_NAME,
	MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME,
	MEDIA_ASSET_TOKEN_REFERENCE_INDEX_NAME,
} from '../src/common/editor/storage/media-asset-chunk-schema.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

interface CursorStats {
	readonly store: string;
	readonly delivered: number;
	readonly blobValuesDelivered: number;
	readonly blobBytesDelivered: number;
}

interface InstrumentedIndexedDB {
	readonly stats: {
		readonly activeTransactions: number;
		readonly cursorRequests: CursorStats[];
	};
	open(name: string, version?: number): IDBOpenDBRequest;
	failNextPutForStore(storeName: string, error?: Error): void;
	recordCount(databaseName: string, storeName: string): number;
	records(databaseName: string, storeName: string): Record<string, unknown>[];
	seedRecord(databaseName: string, storeName: string, value: unknown, primaryKey?: IDBValidKey): void;
}

test('v2 derivative payloads backfill atomically into exact Blob-free cache entries during v4 upgrade', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('derivative-cache-v3-backfill');
	const legacy = await openLegacyV2Database(indexedDB, databaseName);
	indexedDB.seedRecord(databaseName, VIDEO_DERIVATIVE_STORE_NAME, legacyRecord('cache-a'));
	indexedDB.seedRecord(databaseName, VIDEO_DERIVATIVE_STORE_NAME, legacyRecord('cache-b'));
	legacy.close();

	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	const cacheEntryStore = database.transaction(DERIVATIVE_CACHE_ENTRY_STORE_NAME, 'readonly')
		.objectStore(DERIVATIVE_CACHE_ENTRY_STORE_NAME);
	assert.equal(database.version, 4);
	assert.equal(database.objectStoreNames.contains(DERIVATIVE_CACHE_ENTRY_STORE_NAME), true);
	assert.equal(database.objectStoreNames.contains(MEDIA_ASSET_CHUNK_STORE_NAME), true);
	assert.equal(cacheEntryStore.indexNames.contains(DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME), true);
	assert.deepEqual(indexedDB.records(databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME), [
		cacheEntry('cache-a'),
		cacheEntry('cache-b'),
	]);
	const migrationCursor = indexedDB.stats.cursorRequests.find(({ store }) => store === VIDEO_DERIVATIVE_STORE_NAME);
	assert.deepEqual({
		delivered: migrationCursor?.delivered,
		blobValuesDelivered: migrationCursor?.blobValuesDelivered,
		blobBytesDelivered: migrationCursor?.blobBytesDelivered,
	}, {
		delivered: 2,
		blobValuesDelivered: 2,
		blobBytesDelivered: 26,
	});

	const inventory = await readDerivativeCacheInventory(database);
	assert.deepEqual(inventory, [cacheEntry('cache-a'), cacheEntry('cache-b')]);
	const metadataCursors = indexedDB.stats.cursorRequests
		.filter(({ store }) => store === DERIVATIVE_CACHE_ENTRY_STORE_NAME);
	assert.ok(metadataCursors.length > 0);
	assert.ok(metadataCursors.every(({ blobValuesDelivered, blobBytesDelivered }) => (
		blobValuesDelivered === 0 && blobBytesDelivered === 0
	)));
	database.close();
});

test('a failed cache-entry backfill rolls back both v3 and v4 stores before retry', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('derivative-cache-v3-rollback');
	const legacy = await openLegacyV2Database(indexedDB, databaseName);
	indexedDB.seedRecord(databaseName, VIDEO_DERIVATIVE_STORE_NAME, legacyRecord('cache-a'));
	legacy.close();
	const plannedFailure = new Error('planned cache-entry backfill failure');
	indexedDB.failNextPutForStore(DERIVATIVE_CACHE_ENTRY_STORE_NAME, plannedFailure);

	await assert.rejects(
		openDatabase(indexedDB as unknown as IDBFactory, databaseName),
		(error: unknown) => error === plannedFailure,
	);
	assert.equal(indexedDB.stats.activeTransactions, 0);
	const restored = await openRawDatabase(indexedDB, databaseName, 2);
	assert.equal(restored.version, 2);
	assert.equal(restored.objectStoreNames.contains(DERIVATIVE_CACHE_ENTRY_STORE_NAME), false);
	assert.equal(restored.objectStoreNames.contains(MEDIA_ASSET_CHUNK_STORE_NAME), false);
	assert.equal(indexedDB.recordCount(databaseName, VIDEO_DERIVATIVE_STORE_NAME), 1);
	restored.close();

	const retried = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	assert.equal(retried.version, 4);
	assert.equal(retried.objectStoreNames.contains(MEDIA_ASSET_CHUNK_STORE_NAME), true);
	assert.deepEqual(indexedDB.records(databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME), [cacheEntry('cache-a')]);
	retried.close();
});

test('a spoofed legacy payload key cannot redirect the authoritative migration key', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('derivative-cache-v3-spoof');
	const legacy = await openLegacyV2Database(indexedDB, databaseName);
	indexedDB.seedRecord(
		databaseName,
		VIDEO_DERIVATIVE_STORE_NAME,
		legacyRecord('redirected-key'),
		'authoritative-key',
	);
	legacy.close();

	await assert.rejects(
		openDatabase(indexedDB as unknown as IDBFactory, databaseName),
		/does not match its cursor primary key/u,
	);
	const restored = await openRawDatabase(indexedDB, databaseName, 2);
	assert.equal(restored.objectStoreNames.contains(DERIVATIVE_CACHE_ENTRY_STORE_NAME), false);
	assert.equal(restored.objectStoreNames.contains(MEDIA_ASSET_CHUNK_STORE_NAME), false);
	assert.equal(indexedDB.recordCount(databaseName, VIDEO_DERIVATIVE_STORE_NAME), 1);
	restored.close();
});

test('v3 media records survive v4 creation of the dedicated token-indexed chunk store', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('media-asset-chunks-v4');
	const legacy = await openRawDatabase(indexedDB, databaseName, 3, (database) => {
		database.createObjectStore('mediaAssets', { keyPath: 'sourceId' });
	});
	const legacyMedia = {
		sourceId: 'legacy-media',
		storage: 'indexeddb-blob',
		blob: new Blob(['legacy-container'], { type: 'video/mp4' }),
		size: 16,
		mimeType: 'video/mp4',
	};
	indexedDB.seedRecord(databaseName, 'mediaAssets', legacyMedia);
	legacy.close();

	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	assert.equal(database.version, 4);
	const chunks = database.transaction(MEDIA_ASSET_CHUNK_STORE_NAME, 'readonly')
		.objectStore(MEDIA_ASSET_CHUNK_STORE_NAME);
	const mediaAssets = database.transaction('mediaAssets', 'readonly').objectStore('mediaAssets');
	const sources = database.transaction('sources', 'readonly').objectStore('sources');
	const derivativePayloads = database.transaction(VIDEO_DERIVATIVE_STORE_NAME, 'readonly')
		.objectStore(VIDEO_DERIVATIVE_STORE_NAME);
	const derivativeEntries = database.transaction(DERIVATIVE_CACHE_ENTRY_STORE_NAME, 'readonly')
		.objectStore(DERIVATIVE_CACHE_ENTRY_STORE_NAME);
	assert.equal(chunks.indexNames.contains(MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME), true);
	assert.equal(mediaAssets.indexNames.contains(MEDIA_ASSET_TOKEN_REFERENCE_INDEX_NAME), true);
	assert.equal(mediaAssets.indexNames.contains(BINARY_PATH_REFERENCE_INDEX_NAME), true);
	assert.equal(sources.indexNames.contains(BINARY_PATH_REFERENCE_INDEX_NAME), true);
	assert.equal(derivativePayloads.indexNames.contains(BINARY_PATH_REFERENCE_INDEX_NAME), true);
	assert.equal(derivativeEntries.indexNames.contains(BINARY_PATH_REFERENCE_INDEX_NAME), true);
	assert.deepEqual(indexedDB.records(databaseName, 'mediaAssets'), [legacyMedia]);
	assert.equal(indexedDB.recordCount(databaseName, MEDIA_ASSET_CHUNK_STORE_NAME), 0);
	database.close();
});

async function openLegacyV2Database(
	indexedDB: InstrumentedIndexedDB,
	databaseName: string,
): Promise<IDBDatabase> {
	return openRawDatabase(indexedDB, databaseName, 2, (database) => {
		const derivatives = database.createObjectStore(VIDEO_DERIVATIVE_STORE_NAME, { keyPath: 'key' });
		derivatives.createIndex(
			DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
			DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
			{ unique: false },
		);
	});
}

function openRawDatabase(
	indexedDB: InstrumentedIndexedDB,
	databaseName: string,
	version: number,
	onUpgrade?: (database: IDBDatabase) => void,
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(databaseName, version);
		request.onupgradeneeded = () => onUpgrade?.(request.result);
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error || new Error('Could not open the test database.'));
	});
}

function instrumentedIndexedDB(): InstrumentedIndexedDB {
	return createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB;
}

function legacyRecord(key: string): Readonly<Record<string, unknown>> {
	return Object.freeze({
		...cacheEntry(key),
		blob: new Blob(['payload']),
		nestedPayload: { blob: new Blob(['hidden']) },
		mimeType: 'video/webm',
	});
}

function cacheEntry(key: string): Readonly<Record<string, unknown>> {
	return Object.freeze({
		key,
		sourceId: 'source',
		timestamp: key === 'cache-b' ? 1 : 0,
		type: key === 'cache-b' ? 'thumbnail' : 'poster',
		storage: 'indexeddb-blob',
		path: null,
		size: 7,
		committedAt: '2026-07-28T00:00:00.000Z',
		cacheToken: `token-${key}`,
	});
}

function uniqueDatabaseName(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random()}`;
}
