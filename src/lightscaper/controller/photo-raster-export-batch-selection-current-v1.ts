/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ExecutePhotoDevelopCurrentV1 } from '../../common/editor/controller/shared/photo-library-develop-workflow-current-v1.ts';
import type { PreparedPhotoRasterBatchSelection } from './photo-raster-export-batch-selection.ts';
import { preparePhotoRasterBatchSelectionForProfileV1 } from './internal/photo-raster-export-batch-selection-kernel-v1.ts';

export function preparePhotoRasterBatchSelectionCurrentV1(value: unknown, execute: ExecutePhotoDevelopCurrentV1, signal: AbortSignal): Promise<Readonly<PreparedPhotoRasterBatchSelection>> {
	return preparePhotoRasterBatchSelectionForProfileV1('current3', value, execute, signal);
}
