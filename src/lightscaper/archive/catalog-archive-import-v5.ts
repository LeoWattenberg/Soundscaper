/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ScapeProjectInput, ScapeProjectInputReaderFactories } from '../../common/editor/scape-project-input.ts';
import type { PhotoCatalogRootV1 } from '../catalog/types.ts';
import { importPhotoCatalogArchiveKernel, type PhotoCatalogArchiveStageFactoryV5 } from './catalog-archive-import-kernel.ts';
export type { PhotoCatalogArchiveStageV5, PhotoCatalogArchiveStageFactoryV5, PhotoCatalogArchivePresetHeaderV5 } from './catalog-archive-import-kernel.ts';

/** The legacy front door admits only versions1..5 and retains pack2's brush refusal. */
export function importPhotoCatalogArchiveV5(input: ScapeProjectInput, createStage: PhotoCatalogArchiveStageFactoryV5,
	options: Readonly<{ signal?: AbortSignal; readerFactories?: ScapeProjectInputReaderFactories }> = {}): Promise<PhotoCatalogRootV1> {
	if (typeof createStage !== 'function') return Promise.reject(new TypeError('A provisional photo catalog destination is required.'));
	return importPhotoCatalogArchiveKernel(input, (...args) => createStage(args[0], args[1], args[2], args[3]), options, 5);
}
