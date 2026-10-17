/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizePhotoDevelopWorkspaceForProfileV1, createPhotoDevelopWorkspaceForProfileV1, commitPhotoDevelopWorkspaceForProfileV1,
	selectPhotoDevelopHistoryForProfileV1, savePhotoDevelopSnapshotForProfileV1, restorePhotoDevelopSnapshotForProfileV1, deletePhotoDevelopSnapshotForProfileV1,
	type PhotoDevelopHistoryEntryForProfileV1, type PhotoDevelopSnapshotForProfileV1, type PhotoDevelopWorkspaceForProfileV1, type PhotoDevelopHistoryStepV1 } from './photo-develop-workspace-kernel.ts';

export type PhotoDevelopHistoryEntryV4 = PhotoDevelopHistoryEntryForProfileV1<'current4'>;
export type PhotoDevelopSnapshotV4 = PhotoDevelopSnapshotForProfileV1<'current4'>;
export type PhotoDevelopWorkspaceV4 = PhotoDevelopWorkspaceForProfileV1<'current4'>;

export function normalizePhotoDevelopWorkspaceV4(value: unknown): PhotoDevelopWorkspaceV4 { return normalizePhotoDevelopWorkspaceForProfileV1('current4', value); }
export function createPhotoDevelopWorkspaceV4(develop: unknown, step: PhotoDevelopHistoryStepV1): PhotoDevelopWorkspaceV4 {
	return createPhotoDevelopWorkspaceForProfileV1('current4', develop, step);
}
export function commitPhotoDevelopWorkspaceV4(value: unknown, develop: unknown, step: PhotoDevelopHistoryStepV1): PhotoDevelopWorkspaceV4 {
	return commitPhotoDevelopWorkspaceForProfileV1('current4', value, develop, step);
}
export function selectPhotoDevelopHistoryV4(value: unknown, cursor: number): PhotoDevelopWorkspaceV4 { return selectPhotoDevelopHistoryForProfileV1('current4', value, cursor); }
export function savePhotoDevelopSnapshotV4(value: unknown, request: Readonly<{ id: string; name: string; createdAt: string }>): PhotoDevelopWorkspaceV4 {
	return savePhotoDevelopSnapshotForProfileV1('current4', value, request);
}
export function restorePhotoDevelopSnapshotV4(value: unknown, request: Readonly<{ snapshotId: string; label: string; createdAt: string }>): PhotoDevelopWorkspaceV4 {
	return restorePhotoDevelopSnapshotForProfileV1('current4', value, request);
}
export function deletePhotoDevelopSnapshotV4(value: unknown, snapshotId: string): PhotoDevelopWorkspaceV4 {
	return deletePhotoDevelopSnapshotForProfileV1('current4', value, snapshotId);
}
