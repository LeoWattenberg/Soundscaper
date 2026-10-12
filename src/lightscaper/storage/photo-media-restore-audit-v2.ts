/* SPDX-License-Identifier: AGPL-3.0-only */

import { finishPhotoMediaRestoreForProfileV1, type PhotoMediaRestoreCountsV2 } from './internal/photo-media-restore-audit-kernel-v1.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import type { PhotoLibraryRestoreAllocationV1 } from './photo-library-restore-ownership-v1.ts';
import type { PhotoMediaRestorePresetBindingV2 } from './photo-media-restore-presets-v2.ts';
import type { PhotoCatalogArchiveLutResourceV5 } from '../archive/catalog-archive-contract-v5.ts';
import type { PhotoCatalogArchiveMaskRasterResourceV6 } from '../archive/catalog-archive-contract-v6.ts';
export type { PhotoMediaRestoreCountsV2 } from './internal/photo-media-restore-audit-kernel-v1.ts';
export function finishPhotoMediaRestoreV2(media: IDBDatabase, catalog: IDBDatabase, allocation: PhotoLibraryRestoreAllocationV1,
	root: PhotoCatalogRootV1, expected: PhotoMediaRestoreCountsV2, signal: AbortSignal, presets: PhotoMediaRestorePresetBindingV2 | null,
	luts: readonly Readonly<PhotoCatalogArchiveLutResourceV5>[], masks: readonly Readonly<PhotoCatalogArchiveMaskRasterResourceV6>[] = []) {
	return finishPhotoMediaRestoreForProfileV1('legacy2', media, catalog, allocation, root, expected, signal, presets, luts, masks);
}
