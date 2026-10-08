/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_CATALOG_STORES } from './repository-types.ts';
import { PHOTO_QUERY_INDEXES_V1 } from './photo-query-index-v1.ts';
import { PHOTO_QUERY_INDEXES_V2 } from './photo-query-index-v2.ts';

/** Called only inside the owning native versionchange transaction. */
export function createPhotoCatalogStoresV1(database: IDBDatabase): void {
	for (const storeName of PHOTO_CATALOG_STORES) {
		if (database.objectStoreNames.contains(storeName)) continue;
		const store = database.createObjectStore(storeName, { keyPath: storeName === 'photoStackStates' || storeName === 'photoSmartCollectionStates' ? 'catalogId'
			: storeName === 'catalogs' || storeName === 'catalogStates' || storeName === 'photoQueryBuildStates' || storeName === 'photoQueryBuildStatesV2' ? 'id' : 'key' });
		if (storeName === 'photoSmartCollections' || storeName === 'photoSmartCollectionSummaries') store.createIndex('catalogId', 'catalogId');
		if (storeName === 'photoSmartCollections') store.createIndex('referenceKey', 'referenceKeys', { multiEntry: true });
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
}
