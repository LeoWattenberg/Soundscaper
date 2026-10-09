/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDocumentV1OrV2, upgradePhotoDocumentV2, type PhotoDocumentV2, type PhotoVersionV2 } from '../catalog/photo-document-v2.ts';
import { normalizeImageDevelopStateV1OrV2, type ImageDevelopStateV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import { createPhotoDevelopWorkspaceV1, commitPhotoDevelopWorkspaceV1, selectPhotoDevelopHistoryV1,
	savePhotoDevelopSnapshotV1, deletePhotoDevelopSnapshotV1, restorePhotoDevelopSnapshotV1 } from '../catalog/photo-develop-workspace-v1.ts';
import { createPhotoDevelopWorkspaceV2, commitPhotoDevelopWorkspaceV2, selectPhotoDevelopHistoryV2, savePhotoDevelopSnapshotV2, deletePhotoDevelopSnapshotV2, restorePhotoDevelopSnapshotV2, upgradePhotoDevelopWorkspaceV2 } from '../catalog/photo-develop-workspace-v2.ts';
import type { PhotoDevelopV1, PhotoDocumentV1 } from '../catalog/types.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../catalog/types.ts';
import { field, id, integer, name, oneOf, record, utcTimestamp } from '../catalog/value-validation.ts';

export const PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_V2 = Object.freeze(['record-develop', 'select-develop-history',
	'save-develop-snapshot', 'delete-develop-snapshot', 'restore-develop-snapshot'] as const);

export type PhotoDevelopWorkspaceCommandV2 =
	| Readonly<{ type: 'record-develop'; versionId?: string; develop: PhotoDevelopV1 | ImageDevelopStateV2; label: string; createdAt: string }>
	| Readonly<{ type: 'select-develop-history'; versionId?: string; cursor: number }>
	| Readonly<{ type: 'save-develop-snapshot'; versionId?: string; id: string; name: string; createdAt: string }>
	| Readonly<{ type: 'delete-develop-snapshot'; versionId?: string; snapshotId: string }>
	| Readonly<{ type: 'restore-develop-snapshot'; versionId?: string; snapshotId: string; label: string; createdAt: string }>;

/** Detach the complete command before a session may await storage, initialization or a write lease. */
export function normalizePhotoDevelopWorkspaceCommandV2(command: unknown): PhotoDevelopWorkspaceCommandV2 {
	const input = record(command, 'photo develop workspace command', ['type', 'versionId', 'develop', 'label', 'createdAt',
		'cursor', 'id', 'name', 'snapshotId'], ['type']);
	const type = oneOf(field(input, 'type'), PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_V2, 'photo develop workspace command type');
	const version = Object.hasOwn(input, 'versionId') ? { versionId: id(field(input, 'versionId'), 'develop version ID') } : {};
	if (type === 'record-develop') {
		record(input, 'record photo develop', ['type', 'versionId', 'develop', 'label', 'createdAt'], ['type', 'develop', 'label', 'createdAt']);
		return boundedCommand({ type, ...version, develop: normalizeImageDevelopStateV1OrV2(field(input, 'develop')),
			label: name(field(input, 'label'), 'develop history label'), createdAt: utcTimestamp(field(input, 'createdAt'), 'develop history time') });
	} else if (type === 'select-develop-history') {
		record(input, 'select photo develop history', ['type', 'versionId', 'cursor'], ['type', 'cursor']);
		return boundedCommand({ type, ...version,
			cursor: integer(field(input, 'cursor'), 0, LIGHTSCAPER_CATALOG_LIMITS.maximumHistoryEntries - 1, 'develop history cursor') });
	} else if (type === 'save-develop-snapshot') {
		record(input, 'save photo develop snapshot', ['type', 'versionId', 'id', 'name', 'createdAt'], ['type', 'id', 'name', 'createdAt']);
		return boundedCommand({ type, ...version, id: id(field(input, 'id'), 'develop snapshot ID'),
			name: name(field(input, 'name'), 'develop snapshot name'), createdAt: utcTimestamp(field(input, 'createdAt'), 'develop snapshot time') });
	} else if (type === 'delete-develop-snapshot') {
		record(input, 'delete photo develop snapshot', ['type', 'versionId', 'snapshotId'], ['type', 'snapshotId']);
		return boundedCommand({ type, ...version, snapshotId: id(field(input, 'snapshotId'), 'develop snapshot ID') });
	} else {
		record(input, 'restore photo develop snapshot', ['type', 'versionId', 'snapshotId', 'label', 'createdAt'], ['type', 'snapshotId', 'label', 'createdAt']);
		return boundedCommand({ type, ...version, snapshotId: id(field(input, 'snapshotId'), 'develop snapshot ID'),
			label: name(field(input, 'label'), 'develop history label'), createdAt: utcTimestamp(field(input, 'createdAt'), 'develop history time') });
	}
}

function boundedCommand<Value extends PhotoDevelopWorkspaceCommandV2>(value: Value): Value {
	const serialized = JSON.stringify(value), maximum = LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes;
	if (serialized.length > maximum || new TextEncoder().encode(serialized).byteLength > maximum) {
		throw new RangeError('Photo develop command exceeds its byte budget.');
	}
	return Object.freeze(value);
}

/** One immutable version transition. The ordinary photo owner retains CAS, cancellation and publication authority. */
export function applyPhotoDevelopWorkspaceCommandV2(value: unknown, commandValue: unknown): PhotoDocumentV1 | PhotoDocumentV2 {
	const photo = normalizePhotoDocumentV1OrV2(value), command = normalizePhotoDevelopWorkspaceCommandV2(commandValue);
	const versionId = command.versionId ?? photo.activeVersionId, version = photo.versions.find(candidate => candidate.id === versionId);
	if (!version) throw new ReferenceError('The requested photo version is missing.');
	let initial = version.workspace ?? (version.develop.processVersion === 2
		? createPhotoDevelopWorkspaceV2(version.develop, { label: 'Initial settings', createdAt: version.createdAt })
		: createPhotoDevelopWorkspaceV1(version.develop, { label: 'Initial settings', createdAt: version.createdAt }));
	if (command.type === 'record-develop' && command.develop.processVersion === 2 && initial.schemaVersion === 1) initial = upgradePhotoDevelopWorkspaceV2(initial);
	let workspace;
	if (initial.schemaVersion === 2) {
		if (command.type === 'record-develop') workspace = commitPhotoDevelopWorkspaceV2(initial, command.develop, { label: command.label, createdAt: command.createdAt });
		else if (command.type === 'select-develop-history') workspace = selectPhotoDevelopHistoryV2(initial, command.cursor);
		else if (command.type === 'save-develop-snapshot') workspace = savePhotoDevelopSnapshotV2(initial, { id: command.id, name: command.name, createdAt: command.createdAt });
		else if (command.type === 'delete-develop-snapshot') workspace = deletePhotoDevelopSnapshotV2(initial, command.snapshotId);
		else workspace = restorePhotoDevelopSnapshotV2(initial, { snapshotId: command.snapshotId, label: command.label, createdAt: command.createdAt });
	} else {
		if (command.type === 'record-develop') workspace = commitPhotoDevelopWorkspaceV1(initial, command.develop, { label: command.label, createdAt: command.createdAt });
		else if (command.type === 'select-develop-history') workspace = selectPhotoDevelopHistoryV1(initial, command.cursor);
		else if (command.type === 'save-develop-snapshot') workspace = savePhotoDevelopSnapshotV1(initial, { id: command.id, name: command.name, createdAt: command.createdAt });
		else if (command.type === 'delete-develop-snapshot') workspace = deletePhotoDevelopSnapshotV1(initial, command.snapshotId);
		else workspace = restorePhotoDevelopSnapshotV1(initial, { snapshotId: command.snapshotId, label: command.label, createdAt: command.createdAt });
	}
	const develop = workspace.entries[workspace.cursor]!.develop;
	const aggregate = workspace.schemaVersion === 2 ? upgradePhotoDocumentV2(photo) : photo;
	return normalizePhotoDocumentV1OrV2({ ...aggregate, versions: photo.versions.map(candidate => candidate.id === versionId ? { ...candidate, develop, workspace } : candidate) });
}

/** Legacy callers still donate settings without an invented event clock. */
export function applyLegacyPhotoDevelopToVersionV2(version: PhotoVersionV2, develop: PhotoDevelopV1 | ImageDevelopStateV2): PhotoVersionV2 {
	if (!version.workspace) return Object.freeze({ ...version, develop });
	const workspace = develop.processVersion === 2 || version.workspace.schemaVersion === 2
		? commitPhotoDevelopWorkspaceV2(upgradePhotoDevelopWorkspaceV2(version.workspace), develop, { label: 'Develop settings', createdAt: null })
		: commitPhotoDevelopWorkspaceV1(version.workspace, develop, { label: 'Develop settings', createdAt: null });
	return Object.freeze({ ...version, develop: workspace.entries[workspace.cursor]!.develop, workspace });
}
