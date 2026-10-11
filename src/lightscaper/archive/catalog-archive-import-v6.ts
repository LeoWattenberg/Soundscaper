/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeProjectInput, ScapeProjectInputReaderFactories } from '../../common/editor/scape-project-input.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import { importPhotoCatalogArchiveKernel, type PhotoCatalogArchiveStageFactoryV6 } from './catalog-archive-import-kernel.ts';
export type { PhotoCatalogArchiveStageV6, PhotoCatalogArchiveStageFactoryV6 } from './catalog-archive-import-kernel.ts';

/** One reader owns legacy1..5 delegation and V6 extraction through final closure before publication. */
export function importPhotoCatalogArchiveV6(input: ScapeProjectInput, createStage: PhotoCatalogArchiveStageFactoryV6,
	options: Readonly<{ signal?: AbortSignal; readerFactories?: ScapeProjectInputReaderFactories }> = {}): Promise<PhotoCatalogRootV1> {
	return importPhotoCatalogArchiveKernel(input, createStage, options, 6);
}
