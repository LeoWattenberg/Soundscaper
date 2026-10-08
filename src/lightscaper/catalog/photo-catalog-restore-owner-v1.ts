/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { normalizePhotoLibraryRestoreAllocationV1, photoLibraryRestoreNamespacesV1, assertPhotoLibraryRestoreOwnerMarkerV1,
	PHOTO_CATALOG_RESTORE_OWNER_STORE_V1, PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1, type PhotoLibraryRestoreAllocationV1 } from '../storage/photo-library-restore-ownership-v1.ts';
import { assertNotAborted, catalogTransaction } from './catalog-transaction.ts';
import { assertPhotoStackQuerySignalV1, withPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { PHOTO_CATALOG_DATABASE_VERSION, PHOTO_CATALOG_STORES } from './repository-types.ts';
import { field, record } from './value-validation.ts';

export type PhotoCatalogRestoreNamespaceInspectionV1 = 'absent' | 'owned' | 'foreign';
export interface PhotoCatalogRestoreNamespaceInspectionOptionsV1 {
	readonly indexedDB: Pick<IDBFactory, 'open'>;
	readonly allocation: unknown;
	readonly signal?: AbortSignal;
}

export function photoCatalogRestoreNamespaceStoresV1(allocation?: PhotoLibraryRestoreAllocationV1): readonly string[] {
	return allocation === undefined ? PHOTO_CATALOG_STORES : Object.freeze([...PHOTO_CATALOG_STORES, PHOTO_CATALOG_RESTORE_OWNER_STORE_V1]);
}

export function assertPhotoCatalogRestoreNamespaceProfileV1(database: IDBDatabase, allocation?: PhotoLibraryRestoreAllocationV1): void {
	const expected = photoCatalogRestoreNamespaceStoresV1(allocation), seen = new Set<string>();
	if (database.version !== PHOTO_CATALOG_DATABASE_VERSION) throw new TypeError('Catalog restore ownership requires its exact physical schema version.');
	for (const store of database.objectStoreNames) {
		if (seen.size >= expected.length || !expected.includes(store) || seen.has(store)) throw new TypeError('Catalog restore ownership requires its exact physical schema profile.');
		seen.add(store);
	}
	if (seen.size !== expected.length) {
		throw new TypeError('Catalog restore ownership requires its exact physical schema profile.');
	}
	if (allocation !== undefined && database.name !== photoLibraryRestoreNamespacesV1(allocation).catalogDatabaseName) {
		throw new TypeError('Catalog restore owner database differs from its allocation.');
	}
}

export async function assertPhotoCatalogRestoreOwnerV1(store: IDBObjectStore, allocation: PhotoLibraryRestoreAllocationV1): Promise<void> {
	if (!ownerGeometry(store) || await request(store.count()) !== 1) throw new TypeError('Catalog restore owner profile or inventory differs from its allocation.');
	const marker: unknown = await request(store.get(PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1));
	assertPhotoLibraryRestoreOwnerMarkerV1(marker, allocation, 'catalog');
}

/** Allocation point proof only: no catalog inventory, publication or deletion authority. */
export async function inspectPhotoCatalogRestoreNamespaceV1(optionsValue: PhotoCatalogRestoreNamespaceInspectionOptionsV1): Promise<PhotoCatalogRestoreNamespaceInspectionV1> {
	const input = record(optionsValue, 'catalog restore inspection options', ['indexedDB', 'allocation', 'signal'], ['indexedDB', 'allocation']);
	const signal = Object.hasOwn(input, 'signal') ? field(input, 'signal') : undefined;
	if (signal !== undefined) assertPhotoStackQuerySignalV1(signal);
	const allocation = normalizePhotoLibraryRestoreAllocationV1(field(input, 'allocation'));
	const databaseName = photoLibraryRestoreNamespacesV1(allocation).catalogDatabaseName;
	const factory = field(input, 'indexedDB') as Pick<IDBFactory, 'open'>;
	if (!factory || typeof factory.open !== 'function') throw new TypeError('Catalog restore inspection requires an IndexedDB factory.');
	const open = factory.open.bind(factory);
	return withPhotoStackQuerySignalV1(signal, async privateSignal => {
		const database = await new Promise<IDBDatabase | null>((resolve, reject) => {
			let absent = false;
			const opening = open(databaseName);
			opening.onupgradeneeded = event => {
				absent = event.oldVersion === 0;
				opening.transaction?.abort();
			};
			opening.onerror = () => {
				try { assertNotAborted(privateSignal); if (absent) resolve(null); else reject(opening.error ?? new Error('Could not inspect the restore namespace.')); }
				catch (error) { reject(error); }
			};
			opening.onsuccess = () => {
				try { assertNotAborted(privateSignal); resolve(opening.result); }
				catch (error) { opening.result.close(); reject(error); }
			};
			// A native blocked/open request remains joined until a terminal transport event.
		});
		if (database === null) return 'absent';
		try {
			try { assertPhotoCatalogRestoreNamespaceProfileV1(database, allocation); } catch { return 'foreign'; }
			return await catalogTransaction(database, [PHOTO_CATALOG_RESTORE_OWNER_STORE_V1], 'readonly', async stores => {
				const store = stores[PHOTO_CATALOG_RESTORE_OWNER_STORE_V1]!;
				if (!ownerGeometry(store) || await request(store.count()) !== 1) return 'foreign';
				const marker: unknown = await request(store.get(PHOTO_LIBRARY_RESTORE_OWNER_KEY_V1));
				try { assertPhotoLibraryRestoreOwnerMarkerV1(marker, allocation, 'catalog'); return 'owned'; } catch { return 'foreign'; }
			}, privateSignal);
		} finally { database.close(); }
	});
}

function ownerGeometry(store: IDBObjectStore): boolean {
	return store.keyPath === 'key' && store.autoIncrement === false && store.indexNames.length === 0;
}
