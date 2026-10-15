/* SPDX-License-Identifier: AGPL-3.0-only */

import { readPhotoLibraryBatchRenameSelectionForProfileV1, renamePhotoLibraryBatchForProfileV1,
	undoPhotoLibraryBatchRenameForProfileV1, type PhotoBatchRenameSessionPortsForProfileV1 } from './internal/photo-library-batch-rename-kernel-v1.ts';
import type { PhotoLibraryBatchRenamePortV1 } from '../../common/editor/photo-library-batch-rename-port-v1.ts';
import { planPhotoLibraryBatchRenameV1 } from './photo-library-batch-rename-v1.ts';
export { planPhotoLibraryBatchRenameV1 as planPhotoLibraryBatchRenameCurrentV1 } from './photo-library-batch-rename-v1.ts';
export type PhotoBatchRenameSessionPortsCurrentV1 = PhotoBatchRenameSessionPortsForProfileV1<'current4'>;

/** Complete fixed current4 admission shares the existing selected Session writer. */
export function readPhotoLibraryBatchRenameSelectionCurrentV1(ports: PhotoBatchRenameSessionPortsCurrentV1, value: unknown, options: unknown = {}) {
	return readPhotoLibraryBatchRenameSelectionForProfileV1('current4', ports, value, options);
}
export function renamePhotoLibraryBatchCurrentV1(ports: PhotoBatchRenameSessionPortsCurrentV1, value: unknown, options: unknown = {}) {
	return renamePhotoLibraryBatchForProfileV1('current4', ports, value, options);
}
export function undoPhotoLibraryBatchRenameCurrentV1(ports: PhotoBatchRenameSessionPortsCurrentV1, value: unknown, options: unknown = {}) {
	return undoPhotoLibraryBatchRenameForProfileV1('current4', ports, value, options);
}

/** The Current child borrows its parent's writer/owner/lifetime, never a second one. */
export function createPhotoLibraryBatchRenameSessionCurrentV1(ports: PhotoBatchRenameSessionPortsCurrentV1,
	assertAccepting: () => void): Readonly<PhotoLibraryBatchRenamePortV1> {
	return Object.freeze<PhotoLibraryBatchRenamePortV1>({
		readBatchRenameSelection: (ids, options) => readPhotoLibraryBatchRenameSelectionCurrentV1(ports, ids, options),
		planBatchRename: request => { assertAccepting(); return planPhotoLibraryBatchRenameV1(request); },
		renamePhotos: (plan, options) => renamePhotoLibraryBatchCurrentV1(ports, plan, options),
		undoBatchRename: (undo, options) => undoPhotoLibraryBatchRenameCurrentV1(ports, undo, options),
	});
}
