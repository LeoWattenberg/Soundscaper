/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeProjectInput, ScapeProjectInputReaderFactories } from '../../common/editor/scape-project-input.ts';
import { importPhotoCatalogArchiveKernel, type PhotoCatalogArchiveStageFactoryV8 } from './catalog-archive-import-kernel.ts';
export type { PhotoCatalogArchiveStageFactoryV8, PhotoCatalogArchivePresetHeaderV8 } from './catalog-archive-import-kernel.ts';
export function importPhotoCatalogArchiveV8(input: ScapeProjectInput, createStage: PhotoCatalogArchiveStageFactoryV8,
	options: Readonly<{ signal?: AbortSignal; readerFactories?: ScapeProjectInputReaderFactories }> = {}) {
	return importPhotoCatalogArchiveKernel(input, createStage, options, 8);
}
