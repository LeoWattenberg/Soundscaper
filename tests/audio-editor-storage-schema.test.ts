/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
	VIDEO_DERIVATIVE_STORE_NAME,
} from '../src/common/editor/storage/derivative-cache-entry.ts';
import {
	EDITOR_STORAGE_DATABASE_VERSION,
	openDatabase,
} from '../src/common/editor/storage/indexeddb-backend.ts';
import {
	LINKED_VIDEO_ORIGINAL_PROJECT_INDEX_NAME,
	LINKED_VIDEO_ORIGINAL_STORE_NAME,
} from '../src/common/editor/storage/linked-video-original-schema.ts';
import {
	LINKED_ORIGINAL_PROVISIONAL_ROOT_PROJECT_INDEX_NAME,
	LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
} from '../src/common/editor/storage/linked-original-provisional-root.ts';
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
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

interface InstrumentedIndexedDB {
	readonly stats: { readonly activeTransactions: number };
	open(name: string, version?: number): IDBOpenDBRequest;
	failNextPutForStore(storeName: string, error?: Error): void;
	recordCount(databaseName: string, storeName: string): number;
	records(databaseName: string, storeName: string): Record<string, unknown>[];
	seedRecord(databaseName: string, storeName: string, value: unknown, primaryKey?: IDBValidKey): void;
}

test('a fresh open creates the complete current schema', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('storage-schema-fresh');

	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);

	assert.equal(EDITOR_STORAGE_DATABASE_VERSION, 1);
	assertCurrentSchema(database, indexedDB, databaseName);
	database.close();
});

const RETIRED_PRODUCT_DATABASE_NAMES = Object.freeze([
	'kw-media-soundscaper-editor-v21',
	'kw-media-soundscaper-editor-v23',
	'kw-media-soundscaper-editor-v29',
	'kw-media-soundscaper-editor-v30',
	'kw-media-framescaper-editor-v18',
	'kw-media-framescaper-editor-v19',
	'kw-media-framescaper-editor-v20',
	'kw-media-framescaper-editor-v22',
	'kw-media-framescaper-editor-v24',
	'kw-media-framescaper-editor-v25',
	'kw-media-framescaper-editor-v26',
	'kw-media-framescaper-editor-v27',
	'kw-media-framescaper-editor-v28',
	'kw-media-framescaper-editor-v31',
	'kw-media-framescaper-editor-v32',
]);

test('every pre-release product database remains unopened and byte-for-byte recoverable', async () => {
	const indexedDB = instrumentedIndexedDB();
	for (const retiredName of RETIRED_PRODUCT_DATABASE_NAMES) {
		const legacy = await openLegacyDatabase(indexedDB, retiredName);
		indexedDB.seedRecord(retiredName, VIDEO_DERIVATIVE_STORE_NAME, legacyDerivativeRecord());
		indexedDB.seedRecord(retiredName, 'mediaAssets', legacyMediaRecord());
		indexedDB.seedRecord(retiredName, 'retiredStore', {
			key: 'legacy-only',
			value: new Uint8Array([0, 255, retiredName.length]),
		});
		legacy.close();
	}

	for (const baselineName of [
		'kw-media-soundscaper-editor-v1',
		'kw-media-framescaper-editor-v1',
	]) {
		const database = await openDatabase(indexedDB as unknown as IDBFactory, baselineName);
		assertCurrentSchema(database, indexedDB, baselineName);
		database.close();
	}

	for (const retiredName of RETIRED_PRODUCT_DATABASE_NAMES) {
		assert.equal(indexedDB.recordCount(retiredName, VIDEO_DERIVATIVE_STORE_NAME), 1, retiredName);
		assert.equal(indexedDB.recordCount(retiredName, 'mediaAssets'), 1, retiredName);
		assert.deepEqual(indexedDB.records(retiredName, 'retiredStore'), [{
			key: 'legacy-only',
			value: new Uint8Array([0, 255, retiredName.length]),
		}], retiredName);
	}
});

test('a failed v1 initialization rolls back before a clean retry', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('storage-schema-v1-rollback');
	const plannedFailure = new Error('planned staging-state initialization failure');
	indexedDB.failNextPutForStore(MEDIA_ASSET_STAGING_STORE_NAME, plannedFailure);

	await assert.rejects(
		openDatabase(indexedDB as unknown as IDBFactory, databaseName),
		(error: unknown) => error === plannedFailure,
	);

	assert.equal(indexedDB.stats.activeTransactions, 0);
	const retried = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	assertCurrentSchema(retried, indexedDB, databaseName);
	retried.close();
});

const LEGACY_DATABASE_VERSION = 2;

function assertCurrentSchema(
	database: IDBDatabase,
	indexedDB: InstrumentedIndexedDB,
	databaseName: string,
): void {
	assert.equal(database.version, EDITOR_STORAGE_DATABASE_VERSION);
	const expectations: Record<string, { keyPath: string; indexes: string[] }> = {
		projects: { keyPath: 'id', indexes: [] },
		revisions: { keyPath: 'key', indexes: ['projectId'] },
		settings: { keyPath: 'key', indexes: [] },
		analysis: { keyPath: 'key', indexes: [] },
		sources: { keyPath: 'id', indexes: [BINARY_PATH_REFERENCE_INDEX_NAME] },
		sourceChunks: { keyPath: 'key', indexes: ['sourceToken'] },
		mediaAssets: {
			keyPath: 'sourceId',
			indexes: [MEDIA_ASSET_TOKEN_REFERENCE_INDEX_NAME, BINARY_PATH_REFERENCE_INDEX_NAME],
		},
		[MEDIA_ASSET_CHUNK_STORE_NAME]: { keyPath: 'key', indexes: [MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME] },
		[MEDIA_ASSET_STAGING_STORE_NAME]: {
			keyPath: 'key',
			indexes: [
				MEDIA_ASSET_STAGING_KIND_INDEX_NAME,
				MEDIA_ASSET_STAGING_TOKEN_INDEX_NAME,
				MEDIA_ASSET_STAGING_PATH_INDEX_NAME,
				MEDIA_ASSET_STAGING_EXPIRY_INDEX_NAME,
			],
		},
		[LINKED_VIDEO_ORIGINAL_STORE_NAME]: {
			keyPath: 'key',
			indexes: [LINKED_VIDEO_ORIGINAL_PROJECT_INDEX_NAME],
		},
		[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME]: {
			keyPath: 'key',
			indexes: [LINKED_ORIGINAL_PROVISIONAL_ROOT_PROJECT_INDEX_NAME],
		},
		[VIDEO_DERIVATIVE_STORE_NAME]: {
			keyPath: 'key',
			indexes: [DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME, BINARY_PATH_REFERENCE_INDEX_NAME],
		},
		[DERIVATIVE_CACHE_ENTRY_STORE_NAME]: {
			keyPath: 'key',
			indexes: [DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME, BINARY_PATH_REFERENCE_INDEX_NAME],
		},
	};
	assert.deepEqual([...database.objectStoreNames].sort(), Object.keys(expectations).sort());
	for (const [storeName, expected] of Object.entries(expectations)) {
		const store = database.transaction(storeName, 'readonly').objectStore(storeName);
		assert.equal(store.keyPath, expected.keyPath, `${storeName} key path`);
		for (const indexName of expected.indexes) {
			assert.equal(store.indexNames.contains(indexName), true, `${storeName} index ${indexName}`);
		}
		if (storeName !== MEDIA_ASSET_STAGING_STORE_NAME) {
			assert.equal(indexedDB.recordCount(databaseName, storeName), 0, `${storeName} starts empty`);
		}
	}
	assert.deepEqual(indexedDB.records(databaseName, MEDIA_ASSET_STAGING_STORE_NAME), [{
		key: MEDIA_ASSET_STAGING_STATE_KEY,
		kind: 'state',
		generation: 'initial',
	}]);
}

async function openLegacyDatabase(
	indexedDB: InstrumentedIndexedDB,
	databaseName: string,
): Promise<IDBDatabase> {
	return openRawDatabase(indexedDB, databaseName, LEGACY_DATABASE_VERSION, (database) => {
		database.createObjectStore('projects', { keyPath: 'id' });
		const derivatives = database.createObjectStore(VIDEO_DERIVATIVE_STORE_NAME, { keyPath: 'key' });
		derivatives.createIndex(
			DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
			DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
			{ unique: false },
		);
		database.createObjectStore('mediaAssets', { keyPath: 'sourceId' });
		database.createObjectStore('retiredStore', { keyPath: 'key' });
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

function legacyDerivativeRecord(): Readonly<Record<string, unknown>> {
	return Object.freeze({
		key: 'legacy-cache',
		sourceId: 'legacy-source',
		timestamp: 3,
		type: 'thumbnail',
		storage: 'indexeddb-blob',
		blob: new Blob(['payload']),
		mimeType: 'video/webm',
	});
}

function legacyMediaRecord(): Readonly<Record<string, unknown>> {
	return Object.freeze({
		sourceId: 'legacy-source',
		storage: 'indexeddb-blob',
		blob: new Blob(['legacy-container'], { type: 'video/mp4' }),
		size: 16,
		sha256: '0'.repeat(64),
		mediaContentDigestVersion: 1,
		mediaContentToken: 'media-content-caller-controlled-token-0001',
	});
}

function instrumentedIndexedDB(): InstrumentedIndexedDB {
	return createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB;
}

function uniqueDatabaseName(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random()}`;
}
