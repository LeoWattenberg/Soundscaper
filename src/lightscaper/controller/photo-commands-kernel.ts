/* SPDX-License-Identifier: AGPL-3.0-only */

import { upgradePhotoDocumentV2 } from '../catalog/photo-document-v2.ts';
import { upgradePhotoDocumentV3 } from '../catalog/photo-document-current-v1.ts';
import { createPhotoVersionForProfileV1 } from '../catalog/photo-history-kernel.ts';
import { field, id, name, oneOf, record } from '../catalog/value-validation.ts';
import { PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_KERNEL, applyPhotoDevelopWorkspaceCommandForProfileV1,
	applyLegacyPhotoDevelopToVersionForProfileV1, readDevelopForCommandProfileV1, readPhotoForCommandProfileV1,
	type PhotoCommandProfileV1, type PhotoForCommandProfileV1 } from './photo-develop-workspace-commands-kernel.ts';

const ATTRIBUTE_FIELDS = ['rating', 'flag', 'colorLabel', 'folderId', 'keywordIds', 'collectionIds'];
const METADATA_FIELDS = ['fileName', 'modifiedTime', 'captureTime', 'orientation', 'cameraMake', 'cameraModel', 'lens',
	'exposureSeconds', 'aperture', 'iso', 'focalLengthMm', 'title', 'caption', 'creator', 'copyright', 'location'];
const COMMAND_TYPES = ['set-attributes', 'set-metadata', 'set-develop', 'create-virtual-copy',
	'activate-version', 'delete-virtual-copy', 'rename-virtual-copy', ...PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_KERNEL] as const;

/** One inert draft; storage and history alone own revision publication. */
export function applyPhotoCommandForProfileV1<Profile extends PhotoCommandProfileV1>(profile: Profile, value: unknown, command: unknown): PhotoForCommandProfileV1<Profile> {
	const photo = readPhotoForCommandProfileV1(profile, value);
	const input = record(command, 'photo command', ['type', 'changes', 'develop', 'versionId', 'id', 'name', 'createdAt', 'sourceVersionId',
		'label', 'cursor', 'snapshotId'], ['type']);
	const type = oneOf(field(input, 'type'), COMMAND_TYPES, 'photo command type');
	if (PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_KERNEL.some(candidate => candidate === type)) {
		return applyPhotoDevelopWorkspaceCommandForProfileV1(profile, photo, command);
	}
	if (type === 'set-attributes' || type === 'set-metadata') {
		record(input, 'photo patch command', ['type', 'changes']);
		const changes = record(field(input, 'changes'), 'photo authored changes', type === 'set-attributes' ? ATTRIBUTE_FIELDS : METADATA_FIELDS, []);
		const patch = Object.fromEntries(Object.keys(changes).map(key => [key, field(changes, key)]));
		return readPhotoForCommandProfileV1(profile, type === 'set-attributes' ? { ...photo, ...patch } : { ...photo, metadata: { ...photo.metadata, ...patch } });
	}
	if (type === 'create-virtual-copy') {
		record(input, 'photo virtual copy command', ['type', 'id', 'name', 'createdAt', 'sourceVersionId'], ['type', 'id', 'name', 'createdAt']);
		return createPhotoVersionForProfileV1(profile, photo, {
			id: id(field(input, 'id'), 'virtual copy ID'), name: name(field(input, 'name'), 'virtual copy name'),
			createdAt: requiredText(field(input, 'createdAt'), 'virtual copy creation time'),
			...(Object.hasOwn(input, 'sourceVersionId') ? { sourceVersionId: id(field(input, 'sourceVersionId'), 'virtual copy source ID') } : {}),
		});
	}
	if (type === 'set-develop') {
		record(input, 'photo develop command', ['type', 'develop', 'versionId'], ['type', 'develop']);
		const versionId = Object.hasOwn(input, 'versionId') ? id(field(input, 'versionId'), 'develop version ID') : photo.activeVersionId;
		requireVersion(photo, versionId);
		const develop = readDevelopForCommandProfileV1(profile, field(input, 'develop'));
		const aggregate = develop.processVersion === 3 ? upgradePhotoDocumentV3(photo)
			: develop.processVersion === 2 && photo.schemaVersion !== 3 ? upgradePhotoDocumentV2(photo) : photo;
		return readPhotoForCommandProfileV1(profile, { ...aggregate, versions: photo.versions.map(version => version.id === versionId
			? applyLegacyPhotoDevelopToVersionForProfileV1(profile, version, develop) : version) });
	}
	record(input, 'photo version command', type === 'rename-virtual-copy' ? ['type', 'versionId', 'name'] : ['type', 'versionId']);
	const versionId = id(field(input, 'versionId'), 'photo command version ID'), version = requireVersion(photo, versionId);
	if (type === 'activate-version') return readPhotoForCommandProfileV1(profile, { ...photo, activeVersionId: versionId });
	if (version.kind !== 'virtual-copy') throw new RangeError('This command requires a virtual copy; the master is retained.');
	if (type === 'rename-virtual-copy') {
		const renamed = name(field(input, 'name'), 'virtual copy name');
		return readPhotoForCommandProfileV1(profile, { ...photo, versions: photo.versions.map(entry => entry.id === versionId ? { ...entry, name: renamed } : entry) });
	}
	const master = photo.versions.find(entry => entry.kind === 'master')!;
	return readPhotoForCommandProfileV1(profile, { ...photo, versions: photo.versions.filter(entry => entry.id !== versionId),
		activeVersionId: photo.activeVersionId === versionId ? master.id : photo.activeVersionId });
}

function requireVersion<Profile extends PhotoCommandProfileV1>(photo: PhotoForCommandProfileV1<Profile>, versionId: string) {
	const version = photo.versions.find(entry => entry.id === versionId);
	if (!version) throw new ReferenceError('The requested photo version is missing.');
	return version;
}
function requiredText(value: unknown, label: string): string {
	if (typeof value !== 'string') throw new TypeError(`${label} requires text.`);
	return value;
}
