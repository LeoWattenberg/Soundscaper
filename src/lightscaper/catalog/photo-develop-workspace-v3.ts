/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDevelopWorkspaceForProfileV1, createPhotoDevelopWorkspaceForProfileV1, commitPhotoDevelopWorkspaceForProfileV1,
	selectPhotoDevelopHistoryForProfileV1, savePhotoDevelopSnapshotForProfileV1, restorePhotoDevelopSnapshotForProfileV1, deletePhotoDevelopSnapshotForProfileV1,
	type PhotoDevelopHistoryEntryForProfileV1, type PhotoDevelopSnapshotForProfileV1, type PhotoDevelopWorkspaceForProfileV1, type PhotoDevelopHistoryStepV1 } from './photo-develop-workspace-kernel.ts';

export type PhotoDevelopHistoryEntryV3 = PhotoDevelopHistoryEntryForProfileV1<'current3'>;
export type PhotoDevelopSnapshotV3 = PhotoDevelopSnapshotForProfileV1<'current3'>;
export type PhotoDevelopWorkspaceV3 = PhotoDevelopWorkspaceForProfileV1<'current3'>;

/** Permanently fixed current3 facade; no caller can select its profile. */
export function normalizePhotoDevelopWorkspaceV3(value: unknown): PhotoDevelopWorkspaceV3 {
	return normalizePhotoDevelopWorkspaceForProfileV1('current3', value);
}
export function createPhotoDevelopWorkspaceV3(develop: unknown, step: PhotoDevelopHistoryStepV1): PhotoDevelopWorkspaceV3 {
	return createPhotoDevelopWorkspaceForProfileV1('current3', develop, step);
}
export function commitPhotoDevelopWorkspaceV3(value: unknown, develop: unknown, step: PhotoDevelopHistoryStepV1): PhotoDevelopWorkspaceV3 {
	return commitPhotoDevelopWorkspaceForProfileV1('current3', value, develop, step);
}
export function selectPhotoDevelopHistoryV3(value: unknown, cursor: number): PhotoDevelopWorkspaceV3 {
	return selectPhotoDevelopHistoryForProfileV1('current3', value, cursor);
}
export function savePhotoDevelopSnapshotV3(value: unknown, request: Readonly<{ id: string; name: string; createdAt: string }>): PhotoDevelopWorkspaceV3 {
	return savePhotoDevelopSnapshotForProfileV1('current3', value, request);
}
export function restorePhotoDevelopSnapshotV3(value: unknown, request: Readonly<{ snapshotId: string; label: string; createdAt: string }>): PhotoDevelopWorkspaceV3 {
	return restorePhotoDevelopSnapshotForProfileV1('current3', value, request);
}
export function deletePhotoDevelopSnapshotV3(value: unknown, snapshotId: string): PhotoDevelopWorkspaceV3 {
	return deletePhotoDevelopSnapshotForProfileV1('current3', value, snapshotId);
}
