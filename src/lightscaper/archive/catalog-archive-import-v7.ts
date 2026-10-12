/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeProjectInput, ScapeProjectInputReaderFactories } from '../../common/editor/scape-project-input.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import { importPhotoCatalogArchiveKernel, type PhotoCatalogArchiveStageFactoryV7 } from './catalog-archive-import-kernel.ts';
export type { PhotoCatalogArchiveStageV7, PhotoCatalogArchiveStageFactoryV7, PhotoCatalogArchivePresetHeaderV7 } from './catalog-archive-import-kernel.ts';

/** A single reader dispatches strict1..6 and explicit7 before provisional publication. */
export function importPhotoCatalogArchiveV7(input: ScapeProjectInput, createStage: PhotoCatalogArchiveStageFactoryV7,
	options: Readonly<{ signal?: AbortSignal; readerFactories?: ScapeProjectInputReaderFactories }> = {}): Promise<PhotoCatalogRootV1> {
	return importPhotoCatalogArchiveKernel(input, createStage, options, 7);
}
