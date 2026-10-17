/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopStateThroughV4 } from '../../common/editor/imaging/image-develop-state-v4.ts';
import { createPhotoDevelopWorkspaceV1, commitPhotoDevelopWorkspaceV1, selectPhotoDevelopHistoryV1,
	savePhotoDevelopSnapshotV1, restorePhotoDevelopSnapshotV1, deletePhotoDevelopSnapshotV1, type PhotoDevelopWorkspaceV1 } from './photo-develop-workspace-v1.ts';
import { normalizePhotoDevelopWorkspaceV1OrV2, createPhotoDevelopWorkspaceV2, commitPhotoDevelopWorkspaceV2, selectPhotoDevelopHistoryV2,
	savePhotoDevelopSnapshotV2, restorePhotoDevelopSnapshotV2, deletePhotoDevelopSnapshotV2, upgradePhotoDevelopWorkspaceV2, type PhotoDevelopWorkspaceV2 } from './photo-develop-workspace-v2.ts';
import { normalizePhotoDevelopWorkspaceV3, createPhotoDevelopWorkspaceV3, commitPhotoDevelopWorkspaceV3, selectPhotoDevelopHistoryV3,
	savePhotoDevelopSnapshotV3, restorePhotoDevelopSnapshotV3, deletePhotoDevelopSnapshotV3, type PhotoDevelopWorkspaceV3 } from './photo-develop-workspace-v3.ts';
import { normalizePhotoDevelopWorkspaceV4, createPhotoDevelopWorkspaceV4, commitPhotoDevelopWorkspaceV4, selectPhotoDevelopHistoryV4,
	savePhotoDevelopSnapshotV4, restorePhotoDevelopSnapshotV4, deletePhotoDevelopSnapshotV4, type PhotoDevelopWorkspaceV4 } from './photo-develop-workspace-v4.ts';
import type { PhotoDevelopHistoryStepV1 } from './photo-develop-workspace-kernel.ts';
import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS } from './types.ts';
import { field } from './value-validation.ts';

export type PhotoDevelopWorkspaceCurrentV1 = PhotoDevelopWorkspaceV1 | PhotoDevelopWorkspaceV2 | PhotoDevelopWorkspaceV3 | PhotoDevelopWorkspaceV4;
/** Dispatch only; current loading preserves each strict old envelope. */
export function normalizePhotoDevelopWorkspaceCurrentV1(value: unknown): PhotoDevelopWorkspaceCurrentV1 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Photo workspace requires an own schema version.');
	const version = field(value as Readonly<Record<string, unknown>>, 'schemaVersion');
	if (version === 1 || version === 2) return normalizePhotoDevelopWorkspaceV1OrV2(value);
	if (version === 3) return normalizePhotoDevelopWorkspaceV3(value);
	if (version === 4) return normalizePhotoDevelopWorkspaceV4(value);
	throw new RangeError('Unsupported photo develop workspace version.');
}
export function parsePhotoDevelopWorkspaceCurrentV1(value: string): PhotoDevelopWorkspaceCurrentV1 {
	if (typeof value !== 'string') throw new TypeError('Photo develop workspace requires JSON text.');
	if (value.length > LIMITS.maximumDocumentBytes || new TextEncoder().encode(value).byteLength > LIMITS.maximumDocumentBytes) {
		throw new RangeError('Photo develop workspace exceeds its byte budget.');
	}
	const parsed: unknown = JSON.parse(value); return normalizePhotoDevelopWorkspaceCurrentV1(parsed);
}
export function serializePhotoDevelopWorkspaceCurrentV1(value: unknown): string {
	return JSON.stringify(normalizePhotoDevelopWorkspaceCurrentV1(value));
}
export function upgradePhotoDevelopWorkspaceV3(value: unknown): PhotoDevelopWorkspaceV3 {
	const workspace = normalizePhotoDevelopWorkspaceCurrentV1(value);
	if (workspace.schemaVersion === 4) throw new RangeError('A process4 workspace cannot downgrade to workspace3.');
	return normalizePhotoDevelopWorkspaceV3({ ...workspace, schemaVersion: 3 });
}
export function upgradePhotoDevelopWorkspaceV4(value: unknown): PhotoDevelopWorkspaceV4 {
	const workspace = normalizePhotoDevelopWorkspaceCurrentV1(value);
	return normalizePhotoDevelopWorkspaceV4({ ...workspace, schemaVersion: 4 });
}
export function createPhotoDevelopWorkspaceCurrentV1(develop: unknown, step: PhotoDevelopHistoryStepV1): PhotoDevelopWorkspaceCurrentV1 {
	const next = normalizeImageDevelopStateThroughV4(develop);
	if (next.processVersion === 4) return createPhotoDevelopWorkspaceV4(next, step);
	if (next.processVersion === 3) return createPhotoDevelopWorkspaceV3(next, step);
	if (next.processVersion === 2) return createPhotoDevelopWorkspaceV2(next, step);
	return createPhotoDevelopWorkspaceV1(next, step);
}
/** Explicit edits may promote; retained successor workspaces never downgrade. */
export function commitPhotoDevelopWorkspaceCurrentV1(value: unknown, develop: unknown, step: PhotoDevelopHistoryStepV1): PhotoDevelopWorkspaceCurrentV1 {
	let workspace = normalizePhotoDevelopWorkspaceCurrentV1(value);
	const next = normalizeImageDevelopStateThroughV4(develop);
	if (next.processVersion === 4 && workspace.schemaVersion !== 4) workspace = upgradePhotoDevelopWorkspaceV4(workspace);
	else if (next.processVersion === 3 && workspace.schemaVersion < 3) workspace = upgradePhotoDevelopWorkspaceV3(workspace);
	else if (next.processVersion === 2 && workspace.schemaVersion === 1) workspace = upgradePhotoDevelopWorkspaceV2(workspace);
	if (workspace.schemaVersion === 4) return commitPhotoDevelopWorkspaceV4(workspace, next, step);
	if (workspace.schemaVersion === 3) return commitPhotoDevelopWorkspaceV3(workspace, next, step);
	if (workspace.schemaVersion === 2) return commitPhotoDevelopWorkspaceV2(workspace, next, step);
	return commitPhotoDevelopWorkspaceV1(workspace, next, step);
}
export function selectPhotoDevelopHistoryCurrentV1(value: unknown, cursor: number): PhotoDevelopWorkspaceCurrentV1 {
	const workspace = normalizePhotoDevelopWorkspaceCurrentV1(value);
	if (workspace.schemaVersion === 4) return selectPhotoDevelopHistoryV4(workspace, cursor);
	if (workspace.schemaVersion === 3) return selectPhotoDevelopHistoryV3(workspace, cursor);
	if (workspace.schemaVersion === 2) return selectPhotoDevelopHistoryV2(workspace, cursor);
	return selectPhotoDevelopHistoryV1(workspace, cursor);
}
export function savePhotoDevelopSnapshotCurrentV1(value: unknown, request: Readonly<{ id: string; name: string; createdAt: string }>): PhotoDevelopWorkspaceCurrentV1 {
	const workspace = normalizePhotoDevelopWorkspaceCurrentV1(value);
	if (workspace.schemaVersion === 4) return savePhotoDevelopSnapshotV4(workspace, request);
	if (workspace.schemaVersion === 3) return savePhotoDevelopSnapshotV3(workspace, request);
	if (workspace.schemaVersion === 2) return savePhotoDevelopSnapshotV2(workspace, request);
	return savePhotoDevelopSnapshotV1(workspace, request);
}
export function restorePhotoDevelopSnapshotCurrentV1(value: unknown, request: Readonly<{ snapshotId: string; label: string; createdAt: string }>): PhotoDevelopWorkspaceCurrentV1 {
	const workspace = normalizePhotoDevelopWorkspaceCurrentV1(value);
	if (workspace.schemaVersion === 4) return restorePhotoDevelopSnapshotV4(workspace, request);
	if (workspace.schemaVersion === 3) return restorePhotoDevelopSnapshotV3(workspace, request);
	if (workspace.schemaVersion === 2) return restorePhotoDevelopSnapshotV2(workspace, request);
	return restorePhotoDevelopSnapshotV1(workspace, request);
}
export function deletePhotoDevelopSnapshotCurrentV1(value: unknown, snapshotId: string): PhotoDevelopWorkspaceCurrentV1 {
	const workspace = normalizePhotoDevelopWorkspaceCurrentV1(value);
	if (workspace.schemaVersion === 4) return deletePhotoDevelopSnapshotV4(workspace, snapshotId);
	if (workspace.schemaVersion === 3) return deletePhotoDevelopSnapshotV3(workspace, snapshotId);
	if (workspace.schemaVersion === 2) return deletePhotoDevelopSnapshotV2(workspace, snapshotId);
	return deletePhotoDevelopSnapshotV1(workspace, snapshotId);
}
