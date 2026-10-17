/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoCommandOwnerCurrentV1 } from './photo-command-owner-current-v1.ts';
import { applyPhotoBatchRenameItemForProfileV1, applyPhotoBatchRenameUndoItemForProfileV1 } from './internal/photo-batch-rename-item-kernel-v1.ts';

/** Complete fixed current3 Photo admission; scalar rename and inverse wires stay V1. */
export function applyPhotoBatchRenameItemCurrentV1(owner: PhotoCommandOwnerCurrentV1, value: unknown, selectedIndex: number, options: unknown = {}) {
	return applyPhotoBatchRenameItemForProfileV1('current3', owner, value, selectedIndex, options);
}
export function applyPhotoBatchRenameUndoItemCurrentV1(owner: PhotoCommandOwnerCurrentV1, value: unknown, selectedIndex: number, options: unknown = {}) {
	return applyPhotoBatchRenameUndoItemForProfileV1('current3', owner, value, selectedIndex, options);
}
