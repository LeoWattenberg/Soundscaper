/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../../common/editor/scape-archive-envelope.ts';
import type { ScapeExpandedByteBudget } from '../../common/editor/scape-expanded-byte-budget.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import type { PhotoDocumentV2 } from '../catalog/photo-document-v2.ts';
import { PHOTO_CATALOG_PACK_LIMITS_V2, readPhotoCatalogPackV2 } from './catalog-pack-v2.ts';
import { readCatalogArchivePackEntry } from './archive-pack-entry.ts';

/** The new pack codec has captured iterator methods and intrinsic native
 * cancellation. The borrowed extractor is pinned before bridge scheduling. */
export function readPhotoCatalogPackEntryV2(entry: ScapeArchiveEntry, descriptor: ScapeAssetDescriptor,
	budget: ScapeExpandedByteBudget,
	consume: (photo: PhotoDocumentV1 | PhotoDocumentV2, original: AsyncIterable<Uint8Array>) => Promise<void>, signal?: AbortSignal): Promise<number> {
	const getData = entry.getData;
	if (typeof getData !== 'function') return Promise.reject(new TypeError('A photo pack extractor is required.'));
	const captured = Object.freeze({ ...entry, getData: (target: WritableStream<Uint8Array>, options: unknown) => Reflect.apply(getData, entry, [target, options]) });
	return readCatalogArchivePackEntry(captured, descriptor, budget, PHOTO_CATALOG_PACK_LIMITS_V2.maximumChunkBytes,
		source => readPhotoCatalogPackV2(source, consume, { signal }), signal);
}
