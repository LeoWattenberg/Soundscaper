/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDevelopWorkspaceForProfileV1, createPhotoDevelopWorkspaceForProfileV1, commitPhotoDevelopWorkspaceForProfileV1,
	selectPhotoDevelopHistoryForProfileV1, savePhotoDevelopSnapshotForProfileV1, restorePhotoDevelopSnapshotForProfileV1, deletePhotoDevelopSnapshotForProfileV1,
	type PhotoDevelopHistoryEntryForProfileV1, type PhotoDevelopSnapshotForProfileV1, type PhotoDevelopWorkspaceForProfileV1, type PhotoDevelopHistoryStepV1 } from './photo-develop-workspace-kernel.ts';
import { normalizePhotoDevelopWorkspaceV1, type PhotoDevelopWorkspaceV1 } from './photo-develop-workspace-v1.ts';
import { LIGHTSCAPER_CATALOG_LIMITS as LIMITS } from './types.ts';
import { field, record } from './value-validation.ts';

export type PhotoDevelopHistoryEntryV2 = PhotoDevelopHistoryEntryForProfileV1<'legacy2'>;
export type PhotoDevelopSnapshotV2 = PhotoDevelopSnapshotForProfileV1<'legacy2'>;
export type PhotoDevelopWorkspaceV2 = PhotoDevelopWorkspaceForProfileV1<'legacy2'>;

/** Permanently fixed legacy2 facade; no caller can select its profile. */
export function normalizePhotoDevelopWorkspaceV2(value: unknown): PhotoDevelopWorkspaceV2 {
	return normalizePhotoDevelopWorkspaceForProfileV1('legacy2', value);
}
export function createPhotoDevelopWorkspaceV2(develop: unknown, step: PhotoDevelopHistoryStepV1): PhotoDevelopWorkspaceV2 {
	return createPhotoDevelopWorkspaceForProfileV1('legacy2', develop, step);
}
export function commitPhotoDevelopWorkspaceV2(value: unknown, develop: unknown, step: PhotoDevelopHistoryStepV1): PhotoDevelopWorkspaceV2 {
	return commitPhotoDevelopWorkspaceForProfileV1('legacy2', value, develop, step);
}
export function selectPhotoDevelopHistoryV2(value: unknown, cursor: number): PhotoDevelopWorkspaceV2 {
	return selectPhotoDevelopHistoryForProfileV1('legacy2', value, cursor);
}
export function savePhotoDevelopSnapshotV2(value: unknown, request: Readonly<{ id: string; name: string; createdAt: string }>): PhotoDevelopWorkspaceV2 {
	return savePhotoDevelopSnapshotForProfileV1('legacy2', value, request);
}
export function restorePhotoDevelopSnapshotV2(value: unknown, request: Readonly<{ snapshotId: string; label: string; createdAt: string }>): PhotoDevelopWorkspaceV2 {
	return restorePhotoDevelopSnapshotForProfileV1('legacy2', value, request);
}
export function deletePhotoDevelopSnapshotV2(value: unknown, snapshotId: string): PhotoDevelopWorkspaceV2 {
	return deletePhotoDevelopSnapshotForProfileV1('legacy2', value, snapshotId);
}

export function serializePhotoDevelopWorkspaceV1OrV2(value: unknown): string {
	return JSON.stringify(normalizePhotoDevelopWorkspaceV1OrV2(value));
}
export function parsePhotoDevelopWorkspaceV1OrV2(value: string): PhotoDevelopWorkspaceV1 | PhotoDevelopWorkspaceV2 {
	if (typeof value !== 'string') throw new TypeError('Photo develop workspace requires JSON text.');
	assertByteLength(value.length); assertByteLength(new TextEncoder().encode(value).byteLength);
	const decoded: unknown = JSON.parse(value); return normalizePhotoDevelopWorkspaceV1OrV2(decoded);
}
/** Reading keeps old bytes; only an explicit V2 edit requests an upgrade. */
export function normalizePhotoDevelopWorkspaceV1OrV2(value: unknown): PhotoDevelopWorkspaceV1 | PhotoDevelopWorkspaceV2 {
	const input = record(value, 'photo develop workspace', ['schemaVersion', 'kind', 'entries', 'cursor', 'snapshots']);
	const version = field(input, 'schemaVersion');
	if (version === 1) return normalizePhotoDevelopWorkspaceV1(input);
	if (version === 2) return normalizePhotoDevelopWorkspaceV2(input);
	throw new RangeError('Unsupported photo develop workspace version.');
}
export function upgradePhotoDevelopWorkspaceV2(value: unknown): PhotoDevelopWorkspaceV2 {
	const workspace = normalizePhotoDevelopWorkspaceV1OrV2(value);
	return normalizePhotoDevelopWorkspaceV2({ ...workspace, schemaVersion: 2 });
}
function assertByteLength(value: number): void {
	if (value > LIMITS.maximumDocumentBytes) throw new RangeError('Photo develop workspace exceeds its byte budget.');
}
