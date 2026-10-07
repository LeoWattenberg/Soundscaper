/* SPDX-License-Identifier: AGPL-3.0-only */

import { readCursorPage, transact } from './indexeddb-backend.ts';
import { BINARY_PATH_REFERENCE_INDEX_NAME } from './media-asset-chunk-schema.ts';
import { MEDIA_ASSET_STAGING_PATH_INDEX_NAME, MEDIA_ASSET_STAGING_STORE_NAME } from './media-asset-staging-schema.ts';
import { DERIVATIVE_CACHE_ENTRY_STORE_NAME, VIDEO_DERIVATIVE_STORE_NAME } from './derivative-cache-entry.ts';
import type { StorageRepositoryPort } from './repository-port.ts';

/** Current binary reachability, without materializing a catalog-sized media inventory. */
export async function hasStoredBinaryPathReference(port: StorageRepositoryPort, path: string): Promise<boolean> {
	const database = await port.database();
	const stores = ['sources', 'mediaAssets', VIDEO_DERIVATIVE_STORE_NAME, DERIVATIVE_CACHE_ENTRY_STORE_NAME];
	if (!database) {
		return [port.memory.sources, port.memory.mediaAssets, port.memory.videoDerivatives, port.memory.mediaAssetStaging]
			.some((records) => [...records.values()].some((value) => value && typeof value === 'object'
				&& 'path' in value && value.path === path));
	}
	return transact(database, [...stores, MEDIA_ASSET_STAGING_STORE_NAME], 'readonly', async (records) => {
		for (const store of stores) {
			if ((await readCursorPage(records[store]!.index(BINARY_PATH_REFERENCE_INDEX_NAME), { query: path, limit: 1 })).length) return true;
		}
		return (await readCursorPage(records[MEDIA_ASSET_STAGING_STORE_NAME]!.index(MEDIA_ASSET_STAGING_PATH_INDEX_NAME),
			{ query: path, limit: 1 })).length > 0;
	});
}
