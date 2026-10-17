/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopStateV1OrV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateThroughV3, type ImageDevelopStateThroughV3 } from '../../common/editor/imaging/image-develop-state-through-v3.ts';
import { normalizeImageDevelopStateThroughV4, type ImageDevelopStateThroughV4 } from '../../common/editor/imaging/image-develop-state-v4.ts';
import { normalizePhotoDocumentV1OrV2, upgradePhotoDocumentV2, type PhotoVersionV2 } from '../catalog/photo-document-v2.ts';
import { normalizePhotoDocumentCurrentV1, upgradePhotoDocumentV3, upgradePhotoDocumentCurrentV1, type PhotoDocumentCurrentV1, type PhotoVersionCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import { normalizePhotoDocumentV3, type PhotoDocumentV3, type PhotoVersionV3 } from '../catalog/photo-document-v3.ts';
import { createPhotoDevelopWorkspaceV1, commitPhotoDevelopWorkspaceV1, selectPhotoDevelopHistoryV1,
	savePhotoDevelopSnapshotV1, deletePhotoDevelopSnapshotV1, restorePhotoDevelopSnapshotV1 } from '../catalog/photo-develop-workspace-v1.ts';
import { createPhotoDevelopWorkspaceV2, commitPhotoDevelopWorkspaceV2, selectPhotoDevelopHistoryV2,
	savePhotoDevelopSnapshotV2, deletePhotoDevelopSnapshotV2, restorePhotoDevelopSnapshotV2, upgradePhotoDevelopWorkspaceV2 } from '../catalog/photo-develop-workspace-v2.ts';
import { createPhotoDevelopWorkspaceCurrentV1, commitPhotoDevelopWorkspaceCurrentV1, selectPhotoDevelopHistoryCurrentV1,
	savePhotoDevelopSnapshotCurrentV1, deletePhotoDevelopSnapshotCurrentV1, restorePhotoDevelopSnapshotCurrentV1,
	type PhotoDevelopWorkspaceCurrentV1 } from '../catalog/photo-develop-workspace-current-v1.ts';
import { LIGHTSCAPER_CATALOG_LIMITS } from '../catalog/types.ts';
import { field, id, integer, name, oneOf, record, utcTimestamp } from '../catalog/value-validation.ts';
import type { PhotoDevelopWorkspaceCommandV2 } from './photo-develop-workspace-commands-v2.ts';
import type { PhotoDevelopWorkspaceCommandCurrentV1 } from './photo-develop-workspace-commands-current-v1.ts';

export type PhotoCommandProfileV1 = 'legacy2' | 'current3' | 'current4';
export type PhotoForCommandProfileV1<Profile extends PhotoCommandProfileV1> = Profile extends 'legacy2'
	? ReturnType<typeof normalizePhotoDocumentV1OrV2> : Profile extends 'current3' ? ReturnType<typeof normalizePhotoDocumentV1OrV2> | PhotoDocumentV3 : PhotoDocumentCurrentV1;
type Version<Profile extends PhotoCommandProfileV1> = Profile extends 'legacy2' ? PhotoVersionV2 : Profile extends 'current3' ? PhotoVersionV2 | PhotoVersionV3 : PhotoVersionCurrentV1;
type Develop<Profile extends PhotoCommandProfileV1> = Profile extends 'current4' ? ImageDevelopStateThroughV4 : ImageDevelopStateThroughV3;
type CommandThroughV3 = Exclude<PhotoDevelopWorkspaceCommandV2, { type: 'record-develop' }>
	| Readonly<{ type: 'record-develop'; versionId?: string; develop: ImageDevelopStateThroughV3; label: string; createdAt: string }>;
type Command<Profile extends PhotoCommandProfileV1> = Profile extends 'legacy2' ? PhotoDevelopWorkspaceCommandV2
	: Profile extends 'current3' ? CommandThroughV3 : PhotoDevelopWorkspaceCommandCurrentV1;
export const PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_KERNEL = Object.freeze(['record-develop', 'select-develop-history',
	'save-develop-snapshot', 'delete-develop-snapshot', 'restore-develop-snapshot'] as const);

const LEGACY1 = { create: createPhotoDevelopWorkspaceV1, commit: commitPhotoDevelopWorkspaceV1, select: selectPhotoDevelopHistoryV1,
	save: savePhotoDevelopSnapshotV1, remove: deletePhotoDevelopSnapshotV1, restore: restorePhotoDevelopSnapshotV1 };
const LEGACY2 = { create: createPhotoDevelopWorkspaceV2, commit: commitPhotoDevelopWorkspaceV2, select: selectPhotoDevelopHistoryV2,
	save: savePhotoDevelopSnapshotV2, remove: deletePhotoDevelopSnapshotV2, restore: restorePhotoDevelopSnapshotV2 };
const CURRENT = { create: createPhotoDevelopWorkspaceCurrentV1, commit: commitPhotoDevelopWorkspaceCurrentV1, select: selectPhotoDevelopHistoryCurrentV1,
	save: savePhotoDevelopSnapshotCurrentV1, remove: deletePhotoDevelopSnapshotCurrentV1, restore: restorePhotoDevelopSnapshotCurrentV1 };

function assertProfile(profile: PhotoCommandProfileV1): void {
	if (profile !== 'legacy2' && profile !== 'current3' && profile !== 'current4') throw new TypeError('Unsupported fixed photo command profile.');
}

/** Profiles are selected by the two fixed facades; commands never carry policy. */
export function readPhotoForCommandProfileV1<Profile extends PhotoCommandProfileV1>(profile: Profile, value: unknown): PhotoForCommandProfileV1<Profile> {
	assertProfile(profile);
	if (profile === 'legacy2') return normalizePhotoDocumentV1OrV2(value) as PhotoForCommandProfileV1<Profile>;
	if (profile === 'current4') return normalizePhotoDocumentCurrentV1(value) as PhotoForCommandProfileV1<Profile>;
	const photo = normalizePhotoDocumentCurrentV1(value);
	return (photo.schemaVersion === 3 ? normalizePhotoDocumentV3(photo) : photo) as PhotoForCommandProfileV1<Profile>;
}
export function readDevelopForCommandProfileV1<Profile extends PhotoCommandProfileV1>(profile: Profile, value: unknown): Develop<Profile> {
	assertProfile(profile);
	return (profile === 'legacy2' ? normalizeImageDevelopStateV1OrV2(value)
		: profile === 'current3' ? normalizeImageDevelopStateThroughV3(value) : normalizeImageDevelopStateThroughV4(value)) as Develop<Profile>;
}

/** Detach the complete command before storage, initialization or a write lease. */
export function normalizePhotoDevelopWorkspaceCommandForProfileV1<Profile extends PhotoCommandProfileV1>(profile: Profile, command: unknown): Command<Profile> {
	assertProfile(profile);
	const input = record(command, 'photo develop workspace command', ['type', 'versionId', 'develop', 'label', 'createdAt',
		'cursor', 'id', 'name', 'snapshotId'], ['type']);
	const type = oneOf(field(input, 'type'), PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_KERNEL, 'photo develop workspace command type');
	const version = Object.hasOwn(input, 'versionId') ? { versionId: id(field(input, 'versionId'), 'develop version ID') } : {};
	if (type === 'record-develop') {
		record(input, 'record photo develop', ['type', 'versionId', 'develop', 'label', 'createdAt'], ['type', 'develop', 'label', 'createdAt']);
		return boundedCommand<Profile>({ type, ...version, develop: readDevelopForCommandProfileV1(profile, field(input, 'develop')),
			label: name(field(input, 'label'), 'develop history label'), createdAt: utcTimestamp(field(input, 'createdAt'), 'develop history time') });
	} else if (type === 'select-develop-history') {
		record(input, 'select photo develop history', ['type', 'versionId', 'cursor'], ['type', 'cursor']);
		return boundedCommand<Profile>({ type, ...version,
			cursor: integer(field(input, 'cursor'), 0, LIGHTSCAPER_CATALOG_LIMITS.maximumHistoryEntries - 1, 'develop history cursor') });
	} else if (type === 'save-develop-snapshot') {
		record(input, 'save photo develop snapshot', ['type', 'versionId', 'id', 'name', 'createdAt'], ['type', 'id', 'name', 'createdAt']);
		return boundedCommand<Profile>({ type, ...version, id: id(field(input, 'id'), 'develop snapshot ID'),
			name: name(field(input, 'name'), 'develop snapshot name'), createdAt: utcTimestamp(field(input, 'createdAt'), 'develop snapshot time') });
	} else if (type === 'delete-develop-snapshot') {
		record(input, 'delete photo develop snapshot', ['type', 'versionId', 'snapshotId'], ['type', 'snapshotId']);
		return boundedCommand<Profile>({ type, ...version, snapshotId: id(field(input, 'snapshotId'), 'develop snapshot ID') });
	}
	record(input, 'restore photo develop snapshot', ['type', 'versionId', 'snapshotId', 'label', 'createdAt'], ['type', 'snapshotId', 'label', 'createdAt']);
	return boundedCommand<Profile>({ type, ...version, snapshotId: id(field(input, 'snapshotId'), 'develop snapshot ID'),
		label: name(field(input, 'label'), 'develop history label'), createdAt: utcTimestamp(field(input, 'createdAt'), 'develop snapshot time') });
}
function boundedCommand<Profile extends PhotoCommandProfileV1>(value: PhotoDevelopWorkspaceCommandCurrentV1): Command<Profile> {
	const serialized = JSON.stringify(value), maximum = LIGHTSCAPER_CATALOG_LIMITS.maximumDocumentBytes;
	if (serialized.length > maximum || new TextEncoder().encode(serialized).byteLength > maximum) {
		throw new RangeError('Photo develop command exceeds its byte budget.');
	}
	return Object.freeze(value) as Command<Profile>;
}

export function applyPhotoDevelopWorkspaceCommandForProfileV1<Profile extends PhotoCommandProfileV1>(profile: Profile, value: unknown, commandValue: unknown): PhotoForCommandProfileV1<Profile> {
	const photo = readPhotoForCommandProfileV1(profile, value), command = normalizePhotoDevelopWorkspaceCommandForProfileV1(profile, commandValue);
	const versionId = command.versionId ?? photo.activeVersionId, version = photo.versions.find(candidate => candidate.id === versionId);
	if (!version) throw new ReferenceError('The requested photo version is missing.');
	const initialOps = profile !== 'legacy2' ? CURRENT : version.develop.processVersion === 2 ? LEGACY2 : LEGACY1;
	let initial = version.workspace ?? initialOps.create(version.develop, { label: 'Initial settings', createdAt: version.createdAt });
	if (profile === 'legacy2' && command.type === 'record-develop' && command.develop.processVersion === 2 && initial.schemaVersion === 1) {
		initial = upgradePhotoDevelopWorkspaceV2(initial);
	}
	const ops = profile !== 'legacy2' ? CURRENT : initial.schemaVersion === 2 ? LEGACY2 : LEGACY1;
	let workspace: PhotoDevelopWorkspaceCurrentV1;
	if (command.type === 'record-develop') workspace = ops.commit(initial, command.develop, { label: command.label, createdAt: command.createdAt });
	else if (command.type === 'select-develop-history') workspace = ops.select(initial, command.cursor);
	else if (command.type === 'save-develop-snapshot') workspace = ops.save(initial, { id: command.id, name: command.name, createdAt: command.createdAt });
	else if (command.type === 'delete-develop-snapshot') workspace = ops.remove(initial, command.snapshotId);
	else workspace = ops.restore(initial, { snapshotId: command.snapshotId, label: command.label, createdAt: command.createdAt });
	const develop = workspace.entries[workspace.cursor]!.develop;
	const aggregate = workspace.schemaVersion >= 3 ? profile === 'current4' ? upgradePhotoDocumentCurrentV1(photo) : upgradePhotoDocumentV3(photo)
		: workspace.schemaVersion === 2 && photo.schemaVersion !== 3 ? upgradePhotoDocumentV2(photo) : photo;
	return readPhotoForCommandProfileV1(profile, { ...aggregate,
		versions: photo.versions.map(candidate => candidate.id === versionId ? { ...candidate, develop, workspace } : candidate) });
}

/** Legacy calls donate settings without an invented event clock. */
export function applyLegacyPhotoDevelopToVersionForProfileV1<Profile extends PhotoCommandProfileV1>(profile: Profile, version: PhotoVersionCurrentV1, developValue: unknown): Version<Profile> {
	const develop = readDevelopForCommandProfileV1(profile, developValue);
	if (!version.workspace) return Object.freeze({ ...version, develop }) as Version<Profile>;
	const workspace = profile !== 'legacy2'
		? CURRENT.commit(version.workspace, develop, { label: 'Develop settings', createdAt: null })
		: develop.processVersion === 2 || version.workspace.schemaVersion === 2
			? LEGACY2.commit(upgradePhotoDevelopWorkspaceV2(version.workspace), develop, { label: 'Develop settings', createdAt: null })
			: LEGACY1.commit(version.workspace, develop, { label: 'Develop settings', createdAt: null });
	return Object.freeze({ ...version, develop: workspace.entries[workspace.cursor]!.develop, workspace }) as Version<Profile>;
}
