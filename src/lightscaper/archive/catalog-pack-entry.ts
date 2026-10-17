/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../../common/editor/scape-archive-envelope.ts';
import type { ScapeExpandedByteBudget } from '../../common/editor/scape-expanded-byte-budget.ts';
import type { PhotoDocumentV1 } from '../catalog/types.ts';
import { PHOTO_CATALOG_PACK_LIMITS_V1, readPhotoCatalogPackV1 } from './catalog-pack.ts';
import { readCatalogArchivePackEntry } from './archive-pack-entry.ts';

/** Backpressure retains at most one bounded emitted chunk while staging a pack. */
export function readPhotoCatalogPackEntryV1(entry: ScapeArchiveEntry, descriptor: ScapeAssetDescriptor,
	budget: ScapeExpandedByteBudget,
	consume: (photo: PhotoDocumentV1, original: AsyncIterable<Uint8Array>) => Promise<void>, signal?: AbortSignal): Promise<number> {
	return readCatalogArchivePackEntry(entry, descriptor, budget, PHOTO_CATALOG_PACK_LIMITS_V1.maximumChunkBytes,
		source => readPhotoCatalogPackV1(source, consume, { signal }), signal);
}
