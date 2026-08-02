/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
	VIDEO_DERIVATIVE_STORE_NAME,
} from '../src/common/editor/storage/derivative-cache-entry.ts';
import { readDerivativeCacheInventory } from '../src/common/editor/storage/derivative-cache-inventory.ts';
import {
	EDITOR_STORAGE_DATABASE_VERSION,
	openDatabase,
} from '../src/common/editor/storage/indexeddb-backend.ts';
import {
	LINKED_VIDEO_ORIGINAL_PROJECT_INDEX_NAME,
	LINKED_VIDEO_ORIGINAL_STORE_NAME,
} from '../src/common/editor/storage/linked-video-original-schema.ts';
import {
	BINARY_PATH_REFERENCE_INDEX_NAME,
	MEDIA_ASSET_CHUNK_STORE_NAME,
	MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME,
	MEDIA_ASSET_TOKEN_REFERENCE_INDEX_NAME,
} from '../src/common/editor/storage/media-asset-chunk-schema.ts';
import {
	MEDIA_ASSET_STAGING_EXPIRY_INDEX_NAME,
	MEDIA_ASSET_STAGING_KIND_INDEX_NAME,
	MEDIA_ASSET_STAGING_PATH_INDEX_NAME,
	MEDIA_ASSET_STAGING_STATE_KEY,
	MEDIA_ASSET_STAGING_STORE_NAME,
	MEDIA_ASSET_STAGING_TOKEN_INDEX_NAME,
} from '../src/common/editor/storage/media-asset-staging-schema.ts';
import { MEDIA_CONTENT_PROVENANCE_SCHEMA_VERSION } from '../src/common/editor/storage/media-content-provenance.ts';
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

test('v2 derivative payloads backfill atomically into exact Blob-free entries during the current upgrade', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('derivative-cache-v3-backfill');
	const legacy = await openLegacyV2Database(indexedDB, databaseName);
	indexedDB.seedRecord(databaseName, VIDEO_DERIVATIVE_STORE_NAME, legacyRecord('cache-a'));
	indexedDB.seedRecord(databaseName, VIDEO_DERIVATIVE_STORE_NAME, legacyRecord('cache-b'));
	legacy.close();

	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	const cacheEntryStore = database.transaction(DERIVATIVE_CACHE_ENTRY_STORE_NAME, 'readonly')
		.objectStore(DERIVATIVE_CACHE_ENTRY_STORE_NAME);
	assert.equal(database.version, EDITOR_STORAGE_DATABASE_VERSION);
	assert.equal(database.objectStoreNames.contains(DERIVATIVE_CACHE_ENTRY_STORE_NAME), true);
	assert.equal(database.objectStoreNames.contains(MEDIA_ASSET_CHUNK_STORE_NAME), true);
	assert.equal(cacheEntryStore.indexNames.contains(DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME), true);
	assertMediaAssetStagingSchema(database, indexedDB, databaseName);
	assertLinkedVideoOriginalSchema(database, indexedDB, databaseName);
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

test('a failed cache-entry backfill rolls back the v3 through v7 stores before retry', async () => {
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
	assert.equal(restored.objectStoreNames.contains(MEDIA_ASSET_STAGING_STORE_NAME), false);
	assert.equal(restored.objectStoreNames.contains(LINKED_VIDEO_ORIGINAL_STORE_NAME), false);
	assert.equal(indexedDB.recordCount(databaseName, VIDEO_DERIVATIVE_STORE_NAME), 1);
	restored.close();

	const retried = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	assert.equal(retried.version, EDITOR_STORAGE_DATABASE_VERSION);
	assert.equal(retried.objectStoreNames.contains(MEDIA_ASSET_CHUNK_STORE_NAME), true);
	assertMediaAssetStagingSchema(retried, indexedDB, databaseName);
	assertLinkedVideoOriginalSchema(retried, indexedDB, databaseName);
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
	assert.equal(restored.objectStoreNames.contains(MEDIA_ASSET_STAGING_STORE_NAME), false);
	assert.equal(restored.objectStoreNames.contains(LINKED_VIDEO_ORIGINAL_STORE_NAME), false);
	assert.equal(indexedDB.recordCount(databaseName, VIDEO_DERIVATIVE_STORE_NAME), 1);
	restored.close();
});

test('v3 media records survive v4 chunk and v5 staging store creation', async () => {
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
	assert.equal(database.version, EDITOR_STORAGE_DATABASE_VERSION);
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
	assertMediaAssetStagingSchema(database, indexedDB, databaseName);
	assertLinkedVideoOriginalSchema(database, indexedDB, databaseName);
	assert.deepEqual(indexedDB.records(databaseName, 'mediaAssets'), [legacyMedia]);
	assert.equal(indexedDB.recordCount(databaseName, MEDIA_ASSET_CHUNK_STORE_NAME), 0);
	database.close();
});

test('v6 databases gain an empty linked-video original binding store and project index', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('linked-video-original-bindings-v7');
	const legacy = await openRawDatabase(
		indexedDB,
		databaseName,
		MEDIA_CONTENT_PROVENANCE_SCHEMA_VERSION,
		(database) => { database.createObjectStore('settings', { keyPath: 'key' }); },
	);
	const legacySetting = { key: 'legacy-setting', value: true };
	indexedDB.seedRecord(databaseName, 'settings', legacySetting);
	legacy.close();

	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	assert.equal(database.version, EDITOR_STORAGE_DATABASE_VERSION);
	assertLinkedVideoOriginalSchema(database, indexedDB, databaseName);
	assert.deepEqual(indexedDB.records(databaseName, 'settings'), [legacySetting]);
	database.close();
});

test('v5 media records discard spoofable digest provenance during the v6 cutover', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('media-content-provenance-v6');
	const legacy = await openRawDatabase(indexedDB, databaseName, 5, (database) => {
		database.createObjectStore('mediaAssets', { keyPath: 'sourceId' });
	});
	const legacyMedia = {
		sourceId: 'legacy-spoofed-media',
		storage: 'indexeddb-blob',
		blob: new Blob(['legacy-container'], { type: 'video/mp4' }),
		size: 16,
		sha256: '0'.repeat(64),
		mediaContentDigestVersion: 1,
		mediaContentToken: 'media-content-caller-controlled-token-0001',
	};
	indexedDB.seedRecord(databaseName, 'mediaAssets', legacyMedia);
	legacy.close();

	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	assert.equal(database.version, EDITOR_STORAGE_DATABASE_VERSION);
	assertLinkedVideoOriginalSchema(database, indexedDB, databaseName);
	const sanitized = { ...legacyMedia };
	delete (sanitized as Partial<typeof legacyMedia>).mediaContentDigestVersion;
	delete (sanitized as Partial<typeof legacyMedia>).mediaContentToken;
	assert.deepEqual(indexedDB.records(databaseName, 'mediaAssets'), [sanitized]);
	const cursor = indexedDB.stats.cursorRequests.find(({ store }) => store === 'mediaAssets');
	assert.deepEqual({ delivered: cursor?.delivered, blobValuesDelivered: cursor?.blobValuesDelivered }, {
		delivered: 1,
		blobValuesDelivered: 1,
	});
	database.close();
});

test('failed v6 provenance sanitization restores the v5 row before a clean retry', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('media-content-provenance-v6-rollback');
	const legacy = await openRawDatabase(indexedDB, databaseName, 5, (database) => {
		database.createObjectStore('mediaAssets', { keyPath: 'sourceId' });
	});
	const legacyMedia = {
		sourceId: 'legacy-rollback-media',
		storage: 'indexeddb-blob',
		blob: new Blob(['legacy-container'], { type: 'video/mp4' }),
		size: 16,
		sha256: '0'.repeat(64),
		mediaContentDigestVersion: 0,
		mediaContentToken: 'media-content-caller-controlled-token-0002',
	};
	indexedDB.seedRecord(databaseName, 'mediaAssets', legacyMedia);
	legacy.close();
	const plannedFailure = new Error('planned media provenance sanitization failure');
	indexedDB.failNextPutForStore('mediaAssets', plannedFailure);

	await assert.rejects(
		openDatabase(indexedDB as unknown as IDBFactory, databaseName),
		(error: unknown) => error === plannedFailure,
	);
	const restored = await openRawDatabase(indexedDB, databaseName, 5);
	assert.equal(restored.version, 5);
	assert.equal(restored.objectStoreNames.contains(LINKED_VIDEO_ORIGINAL_STORE_NAME), false);
	assert.deepEqual(indexedDB.records(databaseName, 'mediaAssets'), [legacyMedia]);
	restored.close();

	const retried = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	assert.equal(retried.version, EDITOR_STORAGE_DATABASE_VERSION);
	assertLinkedVideoOriginalSchema(retried, indexedDB, databaseName);
	const sanitized = { ...legacyMedia };
	delete (sanitized as Partial<typeof legacyMedia>).mediaContentDigestVersion;
	delete (sanitized as Partial<typeof legacyMedia>).mediaContentToken;
	assert.deepEqual(indexedDB.records(databaseName, 'mediaAssets'), [sanitized]);
	retried.close();
});

test('a failed v5 staging-state initialization restores the complete v4 database before retry', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('media-asset-staging-v5-rollback');
	const legacy = await openRawDatabase(indexedDB, databaseName, 4, (database) => {
		database.createObjectStore('mediaAssets', { keyPath: 'sourceId' });
		const chunks = database.createObjectStore(MEDIA_ASSET_CHUNK_STORE_NAME, { keyPath: 'key' });
		chunks.createIndex(
			MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME,
			MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME,
			{ unique: false },
		);
	});
	const legacyMedia = {
		sourceId: 'legacy-media',
		storage: 'indexeddb-chunks',
		mediaChunkToken: 'legacy-token',
		size: 4,
		mimeType: 'video/mp4',
	};
	const legacyChunk = {
		key: 'legacy-token:0',
		mediaChunkToken: 'legacy-token',
		index: 0,
		bytes: Uint8Array.of(1, 2, 3, 4),
		createdAt: 1,
	};
	indexedDB.seedRecord(databaseName, 'mediaAssets', legacyMedia);
	indexedDB.seedRecord(databaseName, MEDIA_ASSET_CHUNK_STORE_NAME, legacyChunk);
	legacy.close();
	const plannedFailure = new Error('planned media staging state failure');
	indexedDB.failNextPutForStore(MEDIA_ASSET_STAGING_STORE_NAME, plannedFailure);

	await assert.rejects(
		openDatabase(indexedDB as unknown as IDBFactory, databaseName),
		(error: unknown) => error === plannedFailure,
	);
	assert.equal(indexedDB.stats.activeTransactions, 0);
	const restored = await openRawDatabase(indexedDB, databaseName, 4);
	assert.equal(restored.version, 4);
	assert.equal(restored.objectStoreNames.contains(MEDIA_ASSET_STAGING_STORE_NAME), false);
	assert.equal(restored.objectStoreNames.contains(LINKED_VIDEO_ORIGINAL_STORE_NAME), false);
	assert.deepEqual(indexedDB.records(databaseName, 'mediaAssets'), [legacyMedia]);
	assert.deepEqual(indexedDB.records(databaseName, MEDIA_ASSET_CHUNK_STORE_NAME), [legacyChunk]);
	restored.close();

	const retried = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	assert.equal(retried.version, EDITOR_STORAGE_DATABASE_VERSION);
	assertMediaAssetStagingSchema(retried, indexedDB, databaseName);
	assertLinkedVideoOriginalSchema(retried, indexedDB, databaseName);
	assert.deepEqual(indexedDB.records(databaseName, 'mediaAssets'), [legacyMedia]);
	assert.deepEqual(indexedDB.records(databaseName, MEDIA_ASSET_CHUNK_STORE_NAME), [legacyChunk]);
	retried.close();
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

function assertMediaAssetStagingSchema(
	database: IDBDatabase,
	indexedDB: InstrumentedIndexedDB,
	databaseName: string,
): void {
	assert.equal(database.objectStoreNames.contains(MEDIA_ASSET_STAGING_STORE_NAME), true);
	const staging = database.transaction(MEDIA_ASSET_STAGING_STORE_NAME, 'readonly')
		.objectStore(MEDIA_ASSET_STAGING_STORE_NAME);
	for (const indexName of [
		MEDIA_ASSET_STAGING_KIND_INDEX_NAME,
		MEDIA_ASSET_STAGING_TOKEN_INDEX_NAME,
		MEDIA_ASSET_STAGING_PATH_INDEX_NAME,
		MEDIA_ASSET_STAGING_EXPIRY_INDEX_NAME,
	]) assert.equal(staging.indexNames.contains(indexName), true);
	assert.deepEqual(indexedDB.records(databaseName, MEDIA_ASSET_STAGING_STORE_NAME), [{
		key: MEDIA_ASSET_STAGING_STATE_KEY,
		kind: 'state',
		generation: 'initial',
	}]);
}

function assertLinkedVideoOriginalSchema(
	database: IDBDatabase,
	indexedDB: InstrumentedIndexedDB,
	databaseName: string,
): void {
	assert.equal(database.objectStoreNames.contains(LINKED_VIDEO_ORIGINAL_STORE_NAME), true);
	const bindings = database.transaction(LINKED_VIDEO_ORIGINAL_STORE_NAME, 'readonly')
		.objectStore(LINKED_VIDEO_ORIGINAL_STORE_NAME);
	assert.equal(bindings.keyPath, 'key');
	assert.equal(bindings.indexNames.contains(LINKED_VIDEO_ORIGINAL_PROJECT_INDEX_NAME), true);
	assert.equal(
		bindings.index(LINKED_VIDEO_ORIGINAL_PROJECT_INDEX_NAME).keyPath,
		LINKED_VIDEO_ORIGINAL_PROJECT_INDEX_NAME,
	);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME), 0);
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
