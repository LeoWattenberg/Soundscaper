/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../../common/editor/scape-archive-envelope.ts';
import type { ScapeExpandedByteBudget } from '../../common/editor/scape-expanded-byte-budget.ts';
import { withPhotoStackQuerySignalV1 } from '../catalog/photo-stack-query-signal-v1.ts';
import type { PhotoDevelopPresetRowV1 } from '../storage/photo-develop-presets-v1.ts';
import { readCatalogArchivePackEntry } from './archive-pack-entry.ts';
import { readPhotoDevelopPresetPackV1, PHOTO_DEVELOP_PRESET_PACK_LIMITS_V1 as LIMITS } from './develop-preset-pack-v1.ts';

/** Digest/length verification and extraction settle before the archive owner can publish. */
export function readPhotoDevelopPresetPackEntryV1(entry: ScapeArchiveEntry, descriptor: ScapeAssetDescriptor,
	budget: ScapeExpandedByteBudget, catalogId: string, consume: (row: PhotoDevelopPresetRowV1) => Promise<void>, signal?: AbortSignal): Promise<number> {
	if (typeof consume !== 'function') throw new TypeError('A provisional Develop preset row consumer is required.');
	if (!Number.isSafeInteger(descriptor.size) || descriptor.size < 1 || descriptor.size > LIMITS.maximumPackBytes) {
		throw new RangeError('Develop preset archive descriptor exceeds its bounded pack byte limit.');
	}
	return withPhotoStackQuerySignalV1(signal, privateSignal => readCatalogArchivePackEntry(entry, descriptor, budget,
		LIMITS.maximumChunkBytes, async source => {
			const row = await readPhotoDevelopPresetPackV1(source, catalogId, { signal: privateSignal });
			await consume(row); privateSignal?.throwIfAborted(); return 1;
		}, privateSignal, 'Develop preset pack'));
}
