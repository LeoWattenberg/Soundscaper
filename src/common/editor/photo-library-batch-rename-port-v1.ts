/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryImportSettingsV1 } from './photo-library-import-settings-port-v1.ts';

export interface PhotoLibraryBatchRenameSelectionV1 {
	readonly photoId: string;
	readonly expectedRevision: number;
	readonly fileName: string;
}
export interface PhotoLibraryBatchRenameSnapshotV1 {
	readonly schemaVersion: 1;
	readonly catalogId: string;
	readonly selection: readonly PhotoLibraryBatchRenameSelectionV1[];
}
export interface PhotoLibraryBatchRenameRequestV1 extends PhotoLibraryBatchRenameSnapshotV1 {
	readonly rename: NonNullable<PhotoLibraryImportSettingsV1['rename']>;
}
export interface PhotoLibraryBatchRenamePlanV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-batch-rename';
	readonly catalogId: string;
	readonly rename: NonNullable<PhotoLibraryImportSettingsV1['rename']>;
	readonly items: readonly Readonly<{ index: number; photoId: string; expectedRevision: number; sourceFileName: string; fileName: string }>[];
}
export interface PhotoLibraryBatchRenameUndoItemV1 {
	readonly index: number;
	readonly photoId: string;
	readonly expectedRevision: number;
	readonly fileName: string;
	readonly previousDisplayName: string;
}
export interface PhotoLibraryBatchRenameUndoV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-batch-rename-undo';
	readonly catalogId: string;
	readonly items: readonly PhotoLibraryBatchRenameUndoItemV1[];
}
export type PhotoLibraryBatchRenameItemV1 =
	| Readonly<{ index: number; photoId: string; previousDisplayName: string; fileName: string;
		revision: number; status: 'renamed' | 'restored' | 'unchanged'; message: null }>
	| Readonly<{ index: number; photoId: string; previousDisplayName: string; fileName: string;
		revision: null; status: 'failed'; message: string }>;
export interface PhotoLibraryBatchRenameReceiptV1 {
	readonly schemaVersion: 1;
	readonly action: 'rename' | 'undo';
	/** Finished means every selected slot has an outcome; individual failures remain explicit. */
	readonly completion: 'finished' | 'cancelled' | 'interrupted';
	readonly items: readonly PhotoLibraryBatchRenameItemV1[];
	/** Remaining revision-fenced restoration work, never a redo packet. */
	readonly undo: PhotoLibraryBatchRenameUndoV1 | null;
	readonly message: string | null;
}
export interface PhotoLibraryBatchRenamePortV1 {
	readBatchRenameSelection(photoIds: readonly string[], options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryBatchRenameSnapshotV1>;
	planBatchRename(request: PhotoLibraryBatchRenameRequestV1): PhotoLibraryBatchRenamePlanV1;
	renamePhotos(plan: PhotoLibraryBatchRenamePlanV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryBatchRenameReceiptV1>;
	undoBatchRename(undo: PhotoLibraryBatchRenameUndoV1, options?: Readonly<{ signal?: AbortSignal }>): Promise<PhotoLibraryBatchRenameReceiptV1>;
}
