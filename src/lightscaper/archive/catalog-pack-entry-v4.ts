/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../../common/editor/scape-archive-envelope.ts';
import type { ScapeExpandedByteBudget } from '../../common/editor/scape-expanded-byte-budget.ts';
import type { PhotoDocumentThroughV3 } from '../catalog/photo-document-through-v3.ts';
import { PHOTO_CATALOG_PACK_LIMITS_V4, readPhotoCatalogPackV4 } from './catalog-pack-v4.ts';
import { readCatalogArchivePackEntry } from './archive-pack-entry.ts';

/** Extraction, complete Original drain and pack digest settle before publish. */
export function readPhotoCatalogPackEntryV4(entry: ScapeArchiveEntry, descriptor: ScapeAssetDescriptor,
	budget: ScapeExpandedByteBudget,
	consume: (photo: PhotoDocumentThroughV3, original: AsyncIterable<Uint8Array>) => Promise<void>, signal?: AbortSignal): Promise<number> {
	const getData = entry.getData;
	if (typeof getData !== 'function') return Promise.reject(new TypeError('A photo pack extractor is required.'));
	const captured = Object.freeze({ ...entry, getData: (target: WritableStream<Uint8Array>, options: unknown) => Reflect.apply(getData, entry, [target, options]) });
	return readCatalogArchivePackEntry(captured, descriptor, budget, PHOTO_CATALOG_PACK_LIMITS_V4.maximumChunkBytes,
		source => readPhotoCatalogPackV4(source, consume, { signal }), signal);
}
