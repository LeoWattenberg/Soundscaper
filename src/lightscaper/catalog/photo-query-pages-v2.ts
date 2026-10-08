/* SPDX-License-Identifier: AGPL-3.0-only */

import { request } from '../../common/editor/storage/indexeddb-backend.ts';
import { catalogTransaction } from './catalog-transaction.ts';
import { validateLightscaperDocumentV1 } from './documents.ts';
import { readIndexState } from './repository-records.ts';
import { PhotoCatalogRevisionConflictError } from './repository-types.ts';
import { readPhotoQueryPageInTransactionV2 } from './photo-query-page-kernel-v2.ts';
import { photoQueryMatcherV2 } from './photo-query-matcher-v2.ts';
import { withPhotoStackQuerySignalV1 } from './photo-stack-query-signal-v1.ts';
import { admitPhotoQueryPageRequestV2, type PhotoQueryPageRequestV2, type PhotoQueryPageV2 } from './photo-query-types-v2.ts';
import { id } from './value-validation.ts';

/** Each native cursor step retains one admitted full row and at most64 existing scalar summaries. */
export async function readPhotoQueryPageV2(database: IDBDatabase, catalogId: string, options: PhotoQueryPageRequestV2 = {}): Promise<PhotoQueryPageV2> {
	const catalog = id(catalogId, 'query catalog ID'), admitted = admitPhotoQueryPageRequestV2(catalog, options);
	const { query, continuation } = admitted;
	return withPhotoStackQuerySignalV1(admitted.signal, signal => catalogTransaction(database,
		['catalogs', 'catalogStates', 'photoQueryRowsV2', 'photoQueryBuildStatesV2'], 'readonly', async stores => {
			const stateValue: unknown = await request(stores.catalogStates.get(catalog));
			if (stateValue === undefined) throw new ReferenceError('Photo catalog is missing.');
			const state = readIndexState(stateValue);
			const root = validateLightscaperDocumentV1(await request(stores.catalogs.get(catalog)) as unknown);
			if (root.kind !== 'photo-catalog' || state.id !== catalog || root.id !== catalog
				|| state.rootRevision !== root.revision || state.photoCount !== root.photoCount) throw new TypeError('Metadata query catalog state disagrees with its root.');
			if (continuation && (continuation.catalogRevision !== root.revision || continuation.indexRevision !== state.indexRevision)) {
				throw new PhotoCatalogRevisionConflictError('catalog');
			}
			return readPhotoQueryPageInTransactionV2(stores, catalog, root, state, query, continuation, () => photoQueryMatcherV2(root, query), signal);
		}, signal));
}
