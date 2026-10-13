/* SPDX-License-Identifier: AGPL-3.0-only */

import { readPhotoLibraryBatchRenameSelectionForProfileV1, renamePhotoLibraryBatchForProfileV1,
	undoPhotoLibraryBatchRenameForProfileV1, type PhotoBatchRenameSessionPortsForProfileV1 } from './internal/photo-library-batch-rename-kernel-v1.ts';
export { planPhotoLibraryBatchRenameV1 as planPhotoLibraryBatchRenameV2 } from './photo-library-batch-rename-v1.ts';
export type PhotoBatchRenameSessionPortsV2 = PhotoBatchRenameSessionPortsForProfileV1<'legacy2'>;

/** Complete fixed legacy2 admission shares the existing selected Session writer. */
export function readPhotoLibraryBatchRenameSelectionV2(ports: PhotoBatchRenameSessionPortsV2, value: unknown, options: unknown = {}) {
	return readPhotoLibraryBatchRenameSelectionForProfileV1('legacy2', ports, value, options);
}
export function renamePhotoLibraryBatchV2(ports: PhotoBatchRenameSessionPortsV2, value: unknown, options: unknown = {}) {
	return renamePhotoLibraryBatchForProfileV1('legacy2', ports, value, options);
}
export function undoPhotoLibraryBatchRenameV2(ports: PhotoBatchRenameSessionPortsV2, value: unknown, options: unknown = {}) {
	return undoPhotoLibraryBatchRenameForProfileV1('legacy2', ports, value, options);
}
