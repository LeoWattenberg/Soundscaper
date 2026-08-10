/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
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
import {
	LINKED_ORIGINAL_PROVISIONAL_ROOT_PROJECT_INDEX_NAME,
	LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
} from './linked-original-provisional-root-schema.ts';
import { EditorStoreBlockedError } from './status.ts';

export const EDITOR_STORAGE_DATABASE_VERSION = 8;
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
				// Pre-current databases are disposable, not migrated: no released
				// build carries data guarantees, so their stores are dropped and the
				// current schema is created from scratch — the storage counterpart of
				// migration.js refusing pre-current project archives.
				if ((event?.oldVersion ?? 0) > 0) {
					for (const storeName of Array.from(database.objectStoreNames)) {
						database.deleteObjectStore(storeName);
					}
				}
				database.createObjectStore('projects', { keyPath: 'id' });
				const revisions = database.createObjectStore('revisions', { keyPath: 'key' });
				revisions.createIndex('projectId', 'projectId', { unique: false });
				database.createObjectStore('settings', { keyPath: 'key' });
				database.createObjectStore('analysis', { keyPath: 'key' });
				const sources = database.createObjectStore('sources', { keyPath: 'id' });
				sources.createIndex(BINARY_PATH_REFERENCE_INDEX_NAME, BINARY_PATH_REFERENCE_INDEX_NAME, { unique: false });
				const sourceChunks = database.createObjectStore('sourceChunks', { keyPath: 'key' });
				sourceChunks.createIndex('sourceToken', 'sourceToken', { unique: false });
				const mediaAssets = database.createObjectStore('mediaAssets', { keyPath: 'sourceId' });
				for (const indexName of [
					MEDIA_ASSET_TOKEN_REFERENCE_INDEX_NAME,
					BINARY_PATH_REFERENCE_INDEX_NAME,
				]) {
					mediaAssets.createIndex(indexName, indexName, { unique: false });
				}
				const mediaChunks = database.createObjectStore(MEDIA_ASSET_CHUNK_STORE_NAME, { keyPath: 'key' });
				mediaChunks.createIndex(
					MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME,
					MEDIA_ASSET_CHUNK_TOKEN_INDEX_NAME,
					{ unique: false },
				);
				const staging = database.createObjectStore(MEDIA_ASSET_STAGING_STORE_NAME, { keyPath: 'key' });
				staging.createIndex(MEDIA_ASSET_STAGING_KIND_INDEX_NAME, MEDIA_ASSET_STAGING_KIND_INDEX_NAME, { unique: false });
				staging.createIndex(MEDIA_ASSET_STAGING_TOKEN_INDEX_NAME, MEDIA_ASSET_STAGING_TOKEN_INDEX_NAME, { unique: true });
				staging.createIndex(MEDIA_ASSET_STAGING_PATH_INDEX_NAME, MEDIA_ASSET_STAGING_PATH_INDEX_NAME, { unique: true });
				staging.createIndex(MEDIA_ASSET_STAGING_EXPIRY_INDEX_NAME, MEDIA_ASSET_STAGING_EXPIRY_INDEX_NAME, { unique: false });
				const stateRequest = staging.put({
					key: MEDIA_ASSET_STAGING_STATE_KEY,
					kind: 'state',
					generation: 'initial',
				});
				stateRequest.onerror = () => abortUpgrade(
					stateRequest.error || new Error('Could not initialize media staging maintenance state.'),
				);
				const linkedVideoOriginals = database.createObjectStore(
					LINKED_ORIGINAL_STORE_NAME,
					{ keyPath: 'key' },
				);
				linkedVideoOriginals.createIndex(
					LINKED_ORIGINAL_PROJECT_INDEX_NAME,
					LINKED_ORIGINAL_PROJECT_INDEX_NAME,
					{ unique: false },
				);
				const linkedOriginalProvisionalRoots = database.createObjectStore(
					LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
					{ keyPath: 'key' },
				);
				linkedOriginalProvisionalRoots.createIndex(
					LINKED_ORIGINAL_PROVISIONAL_ROOT_PROJECT_INDEX_NAME,
					LINKED_ORIGINAL_PROVISIONAL_ROOT_PROJECT_INDEX_NAME,
					{ unique: false },
				);
				for (const storeName of [VIDEO_DERIVATIVE_STORE_NAME, DERIVATIVE_CACHE_ENTRY_STORE_NAME]) {
					const store = database.createObjectStore(storeName, { keyPath: 'key' });
					store.createIndex(
						DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
						DERIVATIVE_CACHE_SOURCE_ID_INDEX_NAME,
						{ unique: false },
					);
					store.createIndex(BINARY_PATH_REFERENCE_INDEX_NAME, BINARY_PATH_REFERENCE_INDEX_NAME, { unique: false });
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
