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
import {
	CATALOG_ORIGINAL_ASSET_INDEX_NAME,
	CATALOG_ORIGINAL_ROOT_STORE_NAME,
	CATALOG_ORIGINAL_SCOPE_INDEX_NAME,
	MEDIA_ASSET_SHA256_INDEX_NAME,
} from './media-catalog-original-schema.ts';

export const EDITOR_STORAGE_DATABASE_VERSION = 2;

interface EditorStorageMigration {
	readonly version: number;
	apply(database: IDBDatabase, abortUpgrade: (error: unknown) => void, transaction: IDBTransaction): void;
}

const EDITOR_STORAGE_MIGRATIONS: readonly EditorStorageMigration[] = Object.freeze([
	Object.freeze({ version: 1, apply: createBaselineStorageSchema }),
	Object.freeze({ version: 2, apply: createCatalogOriginalCustodySchema }),
]);

/** Apply only the owning append-only migrations inside a native upgrade transaction. */
export function applyEditorStorageMigrations(database: IDBDatabase, oldVersion: number, newVersion: number,
	transaction: IDBTransaction | null, abortUpgrade: (error: unknown) => void): void {
	for (const migration of EDITOR_STORAGE_MIGRATIONS) {
		if (migration.version > oldVersion && migration.version <= newVersion) {
			if (!transaction) throw new Error('Storage migration requires an upgrade transaction.');
			migration.apply(database, abortUpgrade, transaction);
		}
	}
}

/**
 * The first shipped browser layout. Future versions append migrations to the
 * registry above; they never drop or recreate stores carrying baseline data.
 */
function createBaselineStorageSchema(
	database: IDBDatabase,
	abortUpgrade: (error: unknown) => void,
): void {
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
}

function createCatalogOriginalCustodySchema(
	database: IDBDatabase,
	_abortUpgrade: (error: unknown) => void,
	transaction: IDBTransaction,
): void {
	transaction.objectStore('mediaAssets').createIndex(MEDIA_ASSET_SHA256_INDEX_NAME, 'sha256', { unique: false });
	const roots = database.createObjectStore(CATALOG_ORIGINAL_ROOT_STORE_NAME, { keyPath: 'key' });
	roots.createIndex(CATALOG_ORIGINAL_ASSET_INDEX_NAME, 'assetId', { unique: false });
	roots.createIndex(CATALOG_ORIGINAL_SCOPE_INDEX_NAME, 'scope', { unique: false });
}

