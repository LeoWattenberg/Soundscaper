/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../../common/editor/scape-archive-envelope.ts';
import type { ScapeExpandedByteBudget } from '../../common/editor/scape-expanded-byte-budget.ts';
import type { PhotoSmartCollectionV1 } from '../catalog/photo-smart-collection-v1.ts';
import { withPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import { readCatalogArchivePackEntry } from './archive-pack-entry.ts';
import { PHOTO_SMART_COLLECTION_PACK_LIMITS_V1 as LIMITS, readPhotoSmartCollectionPackV1 } from './smart-collection-pack-v1.ts';

/** The shared extraction owner authenticates digest/length after all provisional recipes stage. */
export function readPhotoSmartCollectionPackEntryV1(entry: ScapeArchiveEntry, descriptor: ScapeAssetDescriptor,
	budget: ScapeExpandedByteBudget, consume: (definition: PhotoSmartCollectionV1) => Promise<void>, signal?: AbortSignal): Promise<number> {
	if (typeof consume !== 'function') throw new TypeError('A provisional saved collection consumer is required.');
	if (!Number.isSafeInteger(descriptor.size) || descriptor.size < 8 || descriptor.size > LIMITS.maximumPackBytes) {
		throw new RangeError('Smart collection archive descriptor exceeds its bounded pack byte limit.');
	}
	return withPhotoStackQuerySignalV1(signal, privateSignal => readCatalogArchivePackEntry(entry, descriptor, budget,
		LIMITS.maximumChunkBytes, source => readPhotoSmartCollectionPackV1(source, consume, { signal: privateSignal }), privateSignal, 'Smart collection pack'));
}
