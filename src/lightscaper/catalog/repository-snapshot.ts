/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { catalogTransaction } from './catalog-transaction.ts';
import { validateLightscaperDocumentV1 } from './documents.ts';
import { readIndexState } from './repository-records.ts';
import type { PhotoCatalogRootV1 } from './types.ts';
import { id } from './value-validation.ts';

/** The index revision fences photo edits even when the root revision is unchanged. */
export interface PhotoCatalogSnapshotV1 {
	readonly catalog: PhotoCatalogRootV1;
	readonly indexRevision: number;
}

export async function readCatalogSnapshotV1(
	database: IDBDatabase,
	catalogId: string,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<PhotoCatalogSnapshotV1 | null> {
	const key = id(catalogId, 'catalog ID');
	return catalogTransaction(database, ['catalogs', 'catalogStates'], 'readonly', async stores => {
		const [rootValue, stateValue]: unknown[] = await Promise.all([
			request(stores.catalogs.get(key)), request(stores.catalogStates.get(key)),
		]);
		if (rootValue === undefined && stateValue === undefined) return null;
		if (rootValue === undefined || stateValue === undefined) throw new TypeError('Catalog snapshot requires both its root and index state.');
		const catalog = validateLightscaperDocumentV1(rootValue);
		if (catalog.kind !== 'photo-catalog' || catalog.id !== key) throw new TypeError('Stored catalog identity disagrees with its snapshot key.');
		const state = readIndexState(stateValue);
		if (state.id !== key || state.rootRevision !== catalog.revision || state.photoCount !== catalog.photoCount) {
			throw new TypeError('Catalog snapshot index state disagrees with its root.');
		}
		return Object.freeze({ catalog, indexRevision: state.indexRevision });
	}, options.signal);
}
