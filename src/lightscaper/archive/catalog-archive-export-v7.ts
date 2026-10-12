/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MaskRasterSourcePortV1 } from '../../common/editor/imaging/mask-raster-source-port-v1.ts';
import type { PhotoSmartCollectionV1 } from '../catalog/photo-smart-collection-v1.ts';
import type { PhotoStackV1 } from '../catalog/photo-stack-v1.ts';
import type { PhotoCatalogArchiveDocumentV7 } from './catalog-archive-contract-v7.ts';
import type { PhotoCatalogArchiveWrittenResult } from './catalog-archive-writer-kernel.ts';
import type { PhotoCatalogArchiveExportOptionsV3 } from './catalog-archive-export-v3.ts';
import type { PhotoCatalogPackInputV4 } from './catalog-pack-v4.ts';
import type { PhotoCubeLutArchiveSourceV1 } from './cube-lut-archive-source-v1.ts';
import { exportPhotoCatalogArchiveForVersion } from './catalog-archive-export-kernel-v1.ts';
export type PhotoCatalogArchiveExportResultV7 = PhotoCatalogArchiveWrittenResult<PhotoCatalogArchiveDocumentV7>;
export function exportPhotoCatalogArchiveV7(rootValue: unknown,
	photos: Iterable<PhotoCatalogPackInputV4> | AsyncIterable<PhotoCatalogPackInputV4>,
	stacks: Iterable<PhotoStackV1> | AsyncIterable<PhotoStackV1>, stateValue: unknown,
	definitions: Iterable<PhotoSmartCollectionV1> | AsyncIterable<PhotoSmartCollectionV1>, rowValue: unknown,
	lutSource: PhotoCubeLutArchiveSourceV1 | undefined, maskSource: MaskRasterSourcePortV1 | undefined,
	options: PhotoCatalogArchiveExportOptionsV3 = {}): Promise<PhotoCatalogArchiveExportResultV7> {
	return exportPhotoCatalogArchiveForVersion(7, rootValue, photos, stacks, stateValue, definitions, rowValue, lutSource, maskSource, options);
}
