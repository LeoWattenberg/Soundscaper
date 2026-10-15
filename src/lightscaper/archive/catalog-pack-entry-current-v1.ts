/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../../common/editor/scape-archive-envelope.ts';
import type { ScapeExpandedByteBudget } from '../../common/editor/scape-expanded-byte-budget.ts';
import type { PhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { PHOTO_CATALOG_PACK_LIMITS } from './catalog-pack-codec.ts';
import { readPhotoCatalogPackCurrentV1 } from './catalog-pack-current-v1.ts';
import { readCatalogArchivePackEntry } from './archive-pack-entry.ts';

export function readPhotoCatalogPackEntryCurrentV1(entry: ScapeArchiveEntry, descriptor: ScapeAssetDescriptor,
	budget: ScapeExpandedByteBudget, consume: (photo: PhotoDocumentCurrentV1, original: AsyncIterable<Uint8Array>) => Promise<void>, signal?: AbortSignal): Promise<number> {
	const getData = entry.getData;
	if (typeof getData !== 'function') return Promise.reject(new TypeError('A photo pack extractor is required.'));
	const captured = Object.freeze({ ...entry, getData: (target: WritableStream<Uint8Array>, options: unknown) => Reflect.apply(getData, entry, [target, options]) });
	return readCatalogArchivePackEntry(captured, descriptor, budget, PHOTO_CATALOG_PACK_LIMITS.maximumChunkBytes,
		source => readPhotoCatalogPackCurrentV1(source, consume, { signal }), signal);
}
