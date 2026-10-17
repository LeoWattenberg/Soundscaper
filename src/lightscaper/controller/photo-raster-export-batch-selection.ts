/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ExecutePhotoDevelopV2 } from '../../common/editor/controller/shared/photo-library-develop-workflow-v2.ts';
import { preparePhotoRasterBatchSelectionForProfileV1 } from './internal/photo-raster-export-batch-selection-kernel-v1.ts';
export { capturePhotoRasterBatchSelection } from './internal/photo-raster-export-batch-selection-kernel-v1.ts';

export interface PhotoRasterBatchSelection { readonly photoId: string; readonly fileName: string; }
export interface PreparedPhotoRasterBatchSelection {
	readonly catalogId: string;
	readonly members: readonly Readonly<{ photoId: string; versionId: string; expectedRevision: number; sourceFileName: string }>[];
}


export function preparePhotoRasterBatchSelection(value: unknown, execute: ExecutePhotoDevelopV2, signal: AbortSignal): Promise<Readonly<PreparedPhotoRasterBatchSelection>> {
	return preparePhotoRasterBatchSelectionForProfileV1('legacy2', value, execute, signal);
}
