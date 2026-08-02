/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
	projectDerivativeCacheInventoryRecord,
	VIDEO_DERIVATIVE_STORE_NAME,
} from './derivative-cache-entry.ts';
import {
	BINARY_PATH_REFERENCE_INDEX_NAME,
	MEDIA_ASSET_CHUNK_STORE_NAME,
	MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME,
	MEDIA_ASSET_TOKEN_REFERENCE_INDEX_NAME,
} from './media-asset-chunk-schema.ts';
import {
	MEDIA_ASSET_STAGING_EXPIRY_INDEX_NAME,
	MEDIA_ASSET_STAGING_KIND_INDEX_NAME,
	MEDIA_ASSET_STAGING_PATH_INDEX_NAME,
	MEDIA_ASSET_STAGING_STATE_KEY,
	MEDIA_ASSET_STAGING_STORE_NAME,
	MEDIA_ASSET_STAGING_TOKEN_INDEX_NAME,
} from './media-asset-staging-schema.ts';
import {
	LINKED_ORIGINAL_PROJECT_INDEX_NAME,
	LINKED_ORIGINAL_STORE_NAME,
} from './linked-original-schema.ts';
import { MEDIA_CONTENT_PROVENANCE_SCHEMA_VERSION } from './media-content-provenance.ts';
import { EditorStoreBlockedError } from './status.ts';

const DERIVATIVE_CACHE_ENTRY_SCHEMA_VERSION = 3;
export const EDITOR_STORAGE_DATABASE_VERSION = 7;
const DATABASE_VERSION = EDITOR_STORAGE_DATABASE_VERSION;
const SOURCE_CHUNK_CURSOR_PAGE_SIZE = 8;

export const MAX_INDEXEDDB_CURSOR_PAGE_SIZE = 64;

export type IndexedDBCursorProjector<RecordValue> = (
	value: unknown,
	primaryKey: IDBValidKey,
) => RecordValue;

export function openDatabase(
	indexedDB: IDBFactory,
	databaseName: string,
	onVersionChange: () => void = () => undefined,
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		let openRequest: IDBOpenDBRequest;
		let settled = false;
		let upgradeError: Error | null = null;
		try {
			openRequest = indexedDB.open(databaseName, DATABASE_VERSION);
		} catch (error) {
			reject(error);
			return;
		}
		const abortUpgrade = (error: unknown): void => {
			upgradeError ||= error instanceof Error
				? error
				: new Error('Could not upgrade editor storage.');
			const transaction = openRequest.transaction;
			if (transaction) {
				try {
					transaction.abort();
					return;
				} catch { /* The request may already have aborted the transaction. */ }
			}
			if (settled) return;
			settled = true;
			reject(upgradeError);
		};
		openRequest.onupgradeneeded = (event) => {
			try {
				const database = openRequest.result;
				const transaction = openRequest.transaction;
				if (!database.objectStoreNames.contains('projects')) database.createObjectStore('projects', { keyPath: 'id' });
				if (!database.objectStoreNames.contains('revisions')) {
					const store = database.createObjectStore('revisions', { keyPath: 'key' });
					store.createIndex('projectId', 'projectId', { unique: false });
				}
				if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'key' });
				if (!database.objectStoreNames.contains('analysis')) database.createObjectStore('analysis', { keyPath: 'key' });
				let sources: IDBObjectStore;
				if (!database.objectStoreNames.contains('sources')) {
					sources = database.createObjectStore('sources', { keyPath: 'id' });
				} else {
					if (!transaction) throw new Error('The editor storage upgrade transaction is unavailable.');
					sources = transaction.objectStore('sources');
				}
				if (!sources.indexNames.contains(BINARY_PATH_REFERENCE_INDEX_NAME)) {
					sources.createIndex(BINARY_PATH_REFERENCE_INDEX_NAME, BINARY_PATH_REFERENCE_INDEX_NAME, { unique: false });
				}
				if (!database.objectStoreNames.contains('sourceChunks')) {
					const store = database.createObjectStore('sourceChunks', { keyPath: 'key' });
					store.createIndex('sourceToken', 'sourceToken', { unique: false });
				}
				let mediaAssets: IDBObjectStore;
				if (!database.objectStoreNames.contains('mediaAssets')) {
					mediaAssets = database.createObjectStore('mediaAssets', { keyPath: 'sourceId' });
				} else {
					if (!transaction) throw new Error('The editor storage upgrade transaction is unavailable.');
					mediaAssets = transaction.objectStore('mediaAssets');
				}
				for (const indexName of [
					MEDIA_ASSET_TOKEN_REFERENCE_INDEX_NAME,
					BINARY_PATH_REFERENCE_INDEX_NAME,
				]) {
					if (!mediaAssets.indexNames.contains(indexName)) {
						mediaAssets.createIndex(indexName, indexName, { unique: false });
					}
				}
				if (!database.objectStoreNames.contains(MEDIA_ASSET_CHUNK_STORE_NAME)) {
					const store = database.createObjectStore(MEDIA_ASSET_CHUNK_STORE_NAME, { keyPath: 'key' });
					store.createIndex(
						MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME,
						MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME,
						{ unique: false },
					);
				} else {
					if (!transaction) throw new Error('The editor storage upgrade transaction is unavailable.');
					const store = transaction.objectStore(MEDIA_ASSET_CHUNK_STORE_NAME);
					if (!store.indexNames.contains(MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME)) {
						store.createIndex(
							MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME,
							MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME,
							{ unique: false },
						);
					}
				}
				if (!database.objectStoreNames.contains(MEDIA_ASSET_STAGING_STORE_NAME)) {
					const store = database.createObjectStore(MEDIA_ASSET_STAGING_STORE_NAME, { keyPath: 'key' });
					store.createIndex(MEDIA_ASSET_STAGING_KIND_INDEX_NAME, MEDIA_ASSET_STAGING_KIND_INDEX_NAME, { unique: false });
					store.createIndex(MEDIA_ASSET_STAGING_TOKEN_INDEX_NAME, MEDIA_ASSET_STAGING_TOKEN_INDEX_NAME, { unique: true });
					store.createIndex(MEDIA_ASSET_STAGING_PATH_INDEX_NAME, MEDIA_ASSET_STAGING_PATH_INDEX_NAME, { unique: true });
					store.createIndex(MEDIA_ASSET_STAGING_EXPIRY_INDEX_NAME, MEDIA_ASSET_STAGING_EXPIRY_INDEX_NAME, { unique: false });
					const stateRequest = store.put({
						key: MEDIA_ASSET_STAGING_STATE_KEY,
						kind: 'state',
						generation: 'initial',
					});
					stateRequest.onerror = () => abortUpgrade(
						stateRequest.error || new Error('Could not initialize media staging maintenance state.'),
					);
				}
				let linkedVideoOriginals: IDBObjectStore;
				if (!database.objectStoreNames.contains(LINKED_ORIGINAL_STORE_NAME)) {
					linkedVideoOriginals = database.createObjectStore(
						LINKED_ORIGINAL_STORE_NAME,
						{ keyPath: 'key' },
					);
				} else {
					if (!transaction) throw new Error('The editor storage upgrade transaction is unavailable.');
					linkedVideoOriginals = transaction.objectStore(LINKED_ORIGINAL_STORE_NAME);
				}
				if (!linkedVideoOriginals.indexNames.contains(LINKED_ORIGINAL_PROJECT_INDEX_NAME)) {
					linkedVideoOriginals.createIndex(
						LINKED_ORIGINAL_PROJECT_INDEX_NAME,
						LINKED_ORIGINAL_PROJECT_INDEX_NAME,
						{ unique: false },
					);
				}
				if (!database.objectStoreNames.contains(VIDEO_DERIVATIVE_STORE_NAME)) {
					const store = database.createObjectStore(VIDEO_DERIVATIVE_STORE_NAME, { keyPath: 'key' });
					store.createIndex(
						DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
						DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
						{ unique: false },
					);
					store.createIndex(BINARY_PATH_REFERENCE_INDEX_NAME, BINARY_PATH_REFERENCE_INDEX_NAME, { unique: false });
				} else {
					if (!transaction) throw new Error('The editor storage upgrade transaction is unavailable.');
					const store = transaction.objectStore(VIDEO_DERIVATIVE_STORE_NAME);
					if (!store.indexNames.contains(DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME)) {
						store.createIndex(
							DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
							DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
							{ unique: false },
						);
					}
					if (!store.indexNames.contains(BINARY_PATH_REFERENCE_INDEX_NAME)) {
						store.createIndex(BINARY_PATH_REFERENCE_INDEX_NAME, BINARY_PATH_REFERENCE_INDEX_NAME, { unique: false });
					}
				}
				let cacheEntryStore: IDBObjectStore;
				if (!database.objectStoreNames.contains(DERIVATIVE_CACHE_ENTRY_STORE_NAME)) {
					cacheEntryStore = database.createObjectStore(DERIVATIVE_CACHE_ENTRY_STORE_NAME, { keyPath: 'key' });
					cacheEntryStore.createIndex(
						DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
						DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
						{ unique: false },
					);
					cacheEntryStore.createIndex(BINARY_PATH_REFERENCE_INDEX_NAME, BINARY_PATH_REFERENCE_INDEX_NAME, { unique: false });
				} else {
					if (!transaction) throw new Error('The editor storage upgrade transaction is unavailable.');
					cacheEntryStore = transaction.objectStore(DERIVATIVE_CACHE_ENTRY_STORE_NAME);
					if (!cacheEntryStore.indexNames.contains(DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME)) {
						cacheEntryStore.createIndex(
							DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
							DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
							{ unique: false },
						);
					}
					if (!cacheEntryStore.indexNames.contains(BINARY_PATH_REFERENCE_INDEX_NAME)) {
						cacheEntryStore.createIndex(BINARY_PATH_REFERENCE_INDEX_NAME, BINARY_PATH_REFERENCE_INDEX_NAME, { unique: false });
					}
				}
				const oldVersion = event?.oldVersion ?? 0;
				if (oldVersion > 0 && oldVersion < DERIVATIVE_CACHE_ENTRY_SCHEMA_VERSION) {
					if (!transaction) throw new Error('The editor storage upgrade transaction is unavailable.');
					backfillDerivativeCacheEntries(
						transaction.objectStore(VIDEO_DERIVATIVE_STORE_NAME),
						cacheEntryStore,
						abortUpgrade,
					);
				}
				if (oldVersion > 0 && oldVersion < MEDIA_CONTENT_PROVENANCE_SCHEMA_VERSION) {
					sanitizeLegacyMediaContentProvenance(mediaAssets, abortUpgrade);
				}
			} catch (error) {
				abortUpgrade(error);
			}
		};
		openRequest.onsuccess = () => {
			const database = openRequest.result;
			if (settled || upgradeError) {
				database.close();
				if (!settled) {
					settled = true;
					reject(upgradeError);
				}
				return;
			}
			settled = true;
			database.onversionchange = () => {
				database.close();
				onVersionChange();
			};
			resolve(database);
		};
		openRequest.onerror = () => {
			if (settled) return;
			settled = true;
			reject(upgradeError || openRequest.error || new Error('Could not open editor storage.'));
		};
		openRequest.onblocked = () => {
			if (settled) return;
			settled = true;
			reject(new EditorStoreBlockedError());
		};
	});
}

function sanitizeLegacyMediaContentProvenance(
	mediaAssets: IDBObjectStore,
	onError: (error: unknown) => void,
): void {
	let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
	try {
		cursorRequest = mediaAssets.openCursor();
	} catch (error) {
		onError(error);
		return;
	}
	cursorRequest.onerror = () => {
		onError(cursorRequest.error || new Error('Could not enumerate legacy retained-media records.'));
	};
	cursorRequest.onsuccess = () => {
		const cursor = cursorRequest.result;
		if (!cursor) return;
		const record = cursor.value;
		if (!record
			|| typeof record !== 'object'
			|| typeof record.sourceId !== 'string'
			|| record.sourceId !== cursor.primaryKey) {
			onError(new Error('A legacy retained-media record does not match its authoritative key.'));
			return;
		}
		if (!Object.hasOwn(record, 'mediaContentDigestVersion')
			&& !Object.hasOwn(record, 'mediaContentToken')) {
			try {
				cursor.continue();
			} catch (error) {
				onError(error);
			}
			return;
		}
		const sanitized = { ...record };
		delete sanitized.mediaContentDigestVersion;
		delete sanitized.mediaContentToken;
		let putRequest: IDBRequest<IDBValidKey>;
		try {
			putRequest = mediaAssets.put(sanitized);
		} catch (error) {
			onError(error);
			return;
		}
		putRequest.onerror = () => {
			onError(putRequest.error || new Error('Could not sanitize legacy retained-media provenance.'));
		};
		putRequest.onsuccess = () => {
			try {
				cursor.continue();
			} catch (error) {
				onError(error);
			}
		};
	};
}

function backfillDerivativeCacheEntries(
	source: IDBObjectStore,
	destination: IDBObjectStore,
	onError: (error: unknown) => void,
): void {
	let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
	try {
		cursorRequest = source.openCursor();
	} catch (error) {
		onError(error);
		return;
	}
	cursorRequest.onerror = () => {
		onError(cursorRequest.error || new Error('Could not enumerate legacy derivative cache records.'));
	};
	cursorRequest.onsuccess = () => {
		const cursor = cursorRequest.result;
		if (!cursor) return;
		let putRequest: IDBRequest<IDBValidKey>;
		try {
			const cacheEntry = projectDerivativeCacheInventoryRecord(cursor.value, cursor.primaryKey);
			putRequest = destination.put(cacheEntry);
		} catch (error) {
			onError(error);
			return;
		}
		putRequest.onerror = () => {
			onError(putRequest.error || new Error('Could not backfill derivative cache metadata.'));
		};
		putRequest.onsuccess = () => {
			try {
				cursor.continue();
			} catch (error) {
				onError(error);
			}
		};
	};
}

export async function transact<Result>(
	database: IDBDatabase,
	storeNames: string | readonly string[],
	mode: IDBTransactionMode,
	operation: (
		stores: Readonly<Record<string, IDBObjectStore>>,
		transaction: IDBTransaction,
	) => Result | Promise<Result>,
): Promise<Result> {
	const names = Array.isArray(storeNames) ? [...storeNames] : [storeNames];
	const transaction = database.transaction(names, mode);
	const stores = Object.fromEntries(names.map((name) => [name, transaction.objectStore(name)]));
	const completion = transactionCompletion(transaction);
	let result: Result;
	try {
		result = await operation(stores, transaction);
	} catch (error) {
		try { transaction.abort(); } catch { /* Transaction may already be inactive. */ }
		try { await completion; } catch { /* Preserve the operation's primary failure. */ }
		throw error;
	}
	await completion;
	return result;
}

export function request<Result>(idbRequest: IDBRequest<Result>): Promise<Result> {
	return new Promise((resolve, reject) => {
		idbRequest.onsuccess = () => resolve(idbRequest.result);
		idbRequest.onerror = () => reject(idbRequest.error || new Error('An IndexedDB request failed.'));
	});
}

/**
 * Read a hard-capped cursor page, synchronously projecting each delivered value
 * before it enters the retained page. Callers open a new transaction for every
 * page, so pausing an async iterator never retains a browser transaction.
 */
export function readCursorPage<RecordValue = unknown>(
	source: IDBObjectStore | IDBIndex,
	{
		query,
		afterPrimaryKey,
		maximumPrimaryKey,
		limit = SOURCE_CHUNK_CURSOR_PAGE_SIZE,
		project = identityCursorValue<RecordValue>,
	}: {
		readonly query?: IDBValidKey | IDBKeyRange;
		readonly afterPrimaryKey?: IDBValidKey;
		readonly maximumPrimaryKey?: IDBValidKey;
		readonly limit?: number;
		readonly project?: IndexedDBCursorProjector<RecordValue>;
	} = {},
): Promise<RecordValue[]> {
	const maximumRecords = Math.min(
		positiveInteger(limit, SOURCE_CHUNK_CURSOR_PAGE_SIZE),
		MAX_INDEXEDDB_CURSOR_PAGE_SIZE,
	);
	return new Promise((resolve, reject) => {
		const records: RecordValue[] = [];
		let cursorRequest: IDBRequest<IDBCursorWithValue | null>;
		try {
			cursorRequest = query === undefined ? source.openCursor() : source.openCursor(query);
		} catch (error) {
			reject(error);
			return;
		}
		cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Could not enumerate IndexedDB records.'));
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) {
				resolve(records);
				return;
			}
			if (maximumPrimaryKey !== undefined
				&& compareStringKeys(cursor.primaryKey, maximumPrimaryKey) > 0) {
				resolve(records);
				return;
			}
			if (afterPrimaryKey !== undefined) {
				const comparison = compareStringKeys(cursor.primaryKey, afterPrimaryKey);
				if (comparison < 0) {
					try {
						if (query !== undefined) {
							if (typeof cursor.continuePrimaryKey === 'function') cursor.continuePrimaryKey(cursor.key, afterPrimaryKey);
							else cursor.continue();
						} else {
							cursor.continue(afterPrimaryKey);
						}
					} catch (error) {
						reject(error);
					}
					return;
				}
				if (comparison === 0) {
					cursor.continue();
					return;
				}
			}
			try {
				records.push(project(cursor.value, cursor.primaryKey));
			} catch (error) {
				reject(error);
				return;
			}
			if (records.length >= maximumRecords) {
				resolve(records);
				return;
			}
			cursor.continue();
		};
	});
}

export function transactionCompletion(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(transaction.error || new Error('The IndexedDB transaction was aborted.'));
		transaction.onerror = () => reject(transaction.error || new Error('The IndexedDB transaction failed.'));
	});
}

export function deleteByIndex(index: IDBIndex, key: IDBValidKey): Promise<void> {
	return new Promise((resolve, reject) => {
		const cursorRequest = index.openKeyCursor(key);
		cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Could not enumerate IndexedDB records.'));
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) {
				resolve();
				return;
			}
			index.objectStore.delete(cursor.primaryKey);
			cursor.continue();
		};
	});
}

function compareStringKeys(left: IDBValidKey, right: IDBValidKey): number {
	if (left === right) return 0;
	return String(left) < String(right) ? -1 : 1;
}

function positiveInteger(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function identityCursorValue<RecordValue>(value: unknown): RecordValue {
	return value as RecordValue;
}
