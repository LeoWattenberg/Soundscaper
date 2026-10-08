/* SPDX-License-Identifier: AGPL-3.0-only */

import { EditorStoreBlockedError } from '../../common/editor/storage/status.ts';
import { PHOTO_CATALOG_DATABASE_VERSION, PHOTO_CATALOG_STORES } from './repository-types.ts';
import { PHOTO_QUERY_INDEXES_V1 } from './photo-query-index-v1.ts';
import { PHOTO_QUERY_INDEXES_V2 } from './photo-query-index-v2.ts';

/** Own versioned database; shared editor openDatabase would create timeline stores. */
export function openPhotoCatalogDatabaseV1(factory: IDBFactory, name: string, onVersionChange: () => void): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let upgradeError: unknown;
		const request = factory.open(name, PHOTO_CATALOG_DATABASE_VERSION);
		request.onupgradeneeded = (event) => {
			try {
				if (![0, 1, 2, 3].includes(event.oldVersion)) throw new RangeError('Unsupported photo catalog database migration.');
				for (const storeName of PHOTO_CATALOG_STORES) {
					if (request.result.objectStoreNames.contains(storeName)) continue;
					const store = request.result.createObjectStore(storeName, { keyPath: storeName === 'photoStackStates' ? 'catalogId' : storeName === 'catalogs' || storeName === 'catalogStates' || storeName === 'photoQueryBuildStates' || storeName === 'photoQueryBuildStatesV2' ? 'id' : 'key' });
					if (storeName === 'photoStacks' || storeName === 'photoStackMemberships') store.createIndex('catalogId', 'catalogId');
					if (storeName === 'photoStacks') store.createIndex('memberKey', 'memberKeys', { unique: true, multiEntry: true });
					if (storeName === 'photoStackMemberships') store.createIndex('scope', 'scope');
					if (storeName === 'summaries') store.createIndex('catalogId', 'catalogId');
					if (storeName === 'memberships') store.createIndex('scope', 'scope');
					if (storeName === 'photoQueryRows' || storeName === 'photoQueryRowsV2') {
						store.createIndex('catalogId', 'catalogId');
						const indexes = storeName === 'photoQueryRows' ? PHOTO_QUERY_INDEXES_V1 : PHOTO_QUERY_INDEXES_V2;
						for (const [sort, fields] of Object.entries(indexes)) store.createIndex(sort, [...fields]);
					}
				}
			} catch (error) {
				upgradeError = error;
				request.transaction?.abort();
			}
		};
		request.onsuccess = () => {
			const database = request.result;
			if (settled || upgradeError) {
				database.close();
				if (!settled) reject(upgradeError);
				settled = true;
				return;
			}
			settled = true;
			database.onversionchange = () => { database.close(); onVersionChange(); };
			resolve(database);
		};
		request.onerror = () => {
			if (settled) return;
			settled = true;
			reject(upgradeError ?? request.error ?? new Error('Could not open the photo catalog database.'));
		};
		request.onblocked = () => {
			if (settled) return;
			settled = true;
			reject(new EditorStoreBlockedError());
		};
	});
}
