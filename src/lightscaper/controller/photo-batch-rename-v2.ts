/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoCommandOwnerV2 } from './photo-command-owner-v2.ts';
import { applyPhotoBatchRenameItemForProfileV1, applyPhotoBatchRenameUndoItemForProfileV1 } from './internal/photo-batch-rename-item-kernel-v1.ts';

/** Complete fixed legacy2 Photo admission; scalar rename and inverse wires stay V1. */
export function applyPhotoBatchRenameItemV2(owner: PhotoCommandOwnerV2, value: unknown, selectedIndex: number, options: unknown = {}) {
	return applyPhotoBatchRenameItemForProfileV1('legacy2', owner, value, selectedIndex, options);
}
export function applyPhotoBatchRenameUndoItemV2(owner: PhotoCommandOwnerV2, value: unknown, selectedIndex: number, options: unknown = {}) {
	return applyPhotoBatchRenameUndoItemForProfileV1('legacy2', owner, value, selectedIndex, options);
}
