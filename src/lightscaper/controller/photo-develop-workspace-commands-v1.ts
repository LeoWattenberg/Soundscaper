/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDocumentV1 } from '../catalog/photo-document.ts';
import { createPhotoDevelopWorkspaceV1, commitPhotoDevelopWorkspaceV1, selectPhotoDevelopHistoryV1,
	savePhotoDevelopSnapshotV1, deletePhotoDevelopSnapshotV1, restorePhotoDevelopSnapshotV1 } from '../catalog/photo-develop-workspace-v1.ts';
import type { PhotoDevelopV1, PhotoDocumentV1, PhotoVersionV1 } from '../catalog/types.ts';
import { field, id, integer, name, oneOf, record, utcTimestamp } from '../catalog/value-validation.ts';

export const PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_V1 = Object.freeze(['record-develop', 'select-develop-history',
	'save-develop-snapshot', 'delete-develop-snapshot', 'restore-develop-snapshot'] as const);

export type PhotoDevelopWorkspaceCommandV1 =
	| Readonly<{ type: 'record-develop'; versionId?: string; develop: PhotoDevelopV1; label: string; createdAt: string }>
	| Readonly<{ type: 'select-develop-history'; versionId?: string; cursor: number }>
	| Readonly<{ type: 'save-develop-snapshot'; versionId?: string; id: string; name: string; createdAt: string }>
	| Readonly<{ type: 'delete-develop-snapshot'; versionId?: string; snapshotId: string }>
	| Readonly<{ type: 'restore-develop-snapshot'; versionId?: string; snapshotId: string; label: string; createdAt: string }>;

/** One immutable version transition. The ordinary photo owner retains CAS, cancellation and publication authority. */
export function applyPhotoDevelopWorkspaceCommandV1(photo: PhotoDocumentV1, command: unknown): PhotoDocumentV1 {
	const input = record(command, 'photo develop workspace command', ['type', 'versionId', 'develop', 'label', 'createdAt',
		'cursor', 'id', 'name', 'snapshotId'], ['type']);
	const type = oneOf(field(input, 'type'), PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_V1, 'photo develop workspace command type');
	const versionId = Object.hasOwn(input, 'versionId') ? id(field(input, 'versionId'), 'develop version ID') : photo.activeVersionId;
	const version = photo.versions.find(candidate => candidate.id === versionId);
	if (!version) throw new ReferenceError('The requested photo version is missing.');
	const initial = version.workspace ?? createPhotoDevelopWorkspaceV1(version.develop, { label: 'Initial settings', createdAt: version.createdAt });
	let workspace;
	if (type === 'record-develop') {
		record(input, 'record photo develop', ['type', 'versionId', 'develop', 'label', 'createdAt'], ['type', 'develop', 'label', 'createdAt']);
		workspace = commitPhotoDevelopWorkspaceV1(initial, field(input, 'develop'), { label: name(field(input, 'label'), 'develop history label'),
			createdAt: utcTimestamp(field(input, 'createdAt'), 'develop history time') });
	} else if (type === 'select-develop-history') {
		record(input, 'select photo develop history', ['type', 'versionId', 'cursor'], ['type', 'cursor']);
		workspace = selectPhotoDevelopHistoryV1(initial, integer(field(input, 'cursor'), 0, initial.entries.length - 1, 'develop history cursor'));
	} else if (type === 'save-develop-snapshot') {
		record(input, 'save photo develop snapshot', ['type', 'versionId', 'id', 'name', 'createdAt'], ['type', 'id', 'name', 'createdAt']);
		workspace = savePhotoDevelopSnapshotV1(initial, { id: id(field(input, 'id'), 'develop snapshot ID'),
			name: name(field(input, 'name'), 'develop snapshot name'), createdAt: utcTimestamp(field(input, 'createdAt'), 'develop snapshot time') });
	} else if (type === 'delete-develop-snapshot') {
		record(input, 'delete photo develop snapshot', ['type', 'versionId', 'snapshotId'], ['type', 'snapshotId']);
		workspace = deletePhotoDevelopSnapshotV1(initial, id(field(input, 'snapshotId'), 'develop snapshot ID'));
	} else {
		record(input, 'restore photo develop snapshot', ['type', 'versionId', 'snapshotId', 'label', 'createdAt'], ['type', 'snapshotId', 'label', 'createdAt']);
		workspace = restorePhotoDevelopSnapshotV1(initial, { snapshotId: id(field(input, 'snapshotId'), 'develop snapshot ID'),
			label: name(field(input, 'label'), 'develop history label'), createdAt: utcTimestamp(field(input, 'createdAt'), 'develop history time') });
	}
	const develop = workspace.entries[workspace.cursor]!.develop;
	return normalizePhotoDocumentV1({ ...photo, versions: photo.versions.map(candidate => candidate.id === versionId ? { ...candidate, develop, workspace } : candidate) });
}

/** Existing clipboard/settings callers join history after opt-in, without inventing an event timestamp. */
export function applyLegacyPhotoDevelopToVersionV1(version: PhotoVersionV1, develop: PhotoDevelopV1): PhotoVersionV1 {
	if (!version.workspace) return Object.freeze({ ...version, develop });
	const workspace = commitPhotoDevelopWorkspaceV1(version.workspace, develop, { label: 'Develop settings', createdAt: null });
	return Object.freeze({ ...version, develop: workspace.entries[workspace.cursor]!.develop, workspace });
}
