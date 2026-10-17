/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../../common/editor/scape-archive-envelope.ts';
import type { ScapeExpandedByteBudget } from '../../common/editor/scape-expanded-byte-budget.ts';
import type { PhotoStackV1 } from '../catalog/photo-stack-v1.ts';
import { readCatalogArchivePackEntry } from './archive-pack-entry.ts';
import { PHOTO_STACK_PACK_LIMITS_V1, readPhotoStackPackV1 } from './stack-pack.ts';

export function readPhotoStackPackEntryV1(entry: ScapeArchiveEntry, descriptor: ScapeAssetDescriptor,
	budget: ScapeExpandedByteBudget, consume: (stack: PhotoStackV1) => Promise<void>, signal?: AbortSignal): Promise<number> {
	return readCatalogArchivePackEntry(entry, descriptor, budget, PHOTO_STACK_PACK_LIMITS_V1.maximumChunkBytes,
		source => readPhotoStackPackV1(source, consume, { signal }), signal, 'Stack pack');
}
