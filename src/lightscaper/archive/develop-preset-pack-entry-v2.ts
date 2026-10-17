/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeArchiveEntry, ScapeAssetDescriptor } from '../../common/editor/scape-archive-envelope.ts';
import type { ScapeExpandedByteBudget } from '../../common/editor/scape-expanded-byte-budget.ts';
import type { PhotoDevelopPresetRowV1 } from '../storage/photo-develop-presets-v1.ts';
import type { PhotoDevelopPresetRowV2 } from '../storage/photo-develop-preset-row-v2.ts';
import { readCatalogArchivePackEntry } from './archive-pack-entry.ts';
import { readPhotoDevelopPresetPackV2, PHOTO_DEVELOP_PRESET_PACK_LIMITS_V2 as LIMITS } from './develop-preset-pack-v2.ts';
const CHECK = AbortSignal.prototype.throwIfAborted;

/** Full row/digest/extractor completion remains provisional until publish. */
export function readPhotoDevelopPresetPackEntryV2(entry: ScapeArchiveEntry, descriptor: ScapeAssetDescriptor,
	budget: ScapeExpandedByteBudget, catalogId: string,
	consume: (row: PhotoDevelopPresetRowV1 | PhotoDevelopPresetRowV2) => Promise<void>, signal?: AbortSignal): Promise<number> {
	if (typeof consume !== 'function') return Promise.reject(new TypeError('A provisional preset row consumer is required.'));
	if (!Number.isSafeInteger(descriptor.size) || descriptor.size < 1 || descriptor.size > LIMITS.maximumPackBytes) {
		return Promise.reject(new RangeError('Develop preset descriptor exceeds its pack bound.'));
	}
	const getData = entry.getData;
	if (typeof getData !== 'function') return Promise.reject(new TypeError('A preset pack extractor is required.'));
	const captured = Object.freeze({ ...entry, getData: (target: WritableStream<Uint8Array>, options: unknown) => Reflect.apply(getData, entry, [target, options]) });
	return readCatalogArchivePackEntry(captured, descriptor, budget, LIMITS.maximumChunkBytes, async source => {
		const row = await readPhotoDevelopPresetPackV2(source, catalogId, { signal });
		await consume(row); if (signal !== undefined) Reflect.apply(CHECK, signal, []); return 1;
	}, signal, 'Develop preset pack2');
}
