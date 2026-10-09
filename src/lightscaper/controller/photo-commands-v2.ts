/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopStateV1OrV2, type ImageDevelopStateV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import { normalizePhotoDocumentV1OrV2, upgradePhotoDocumentV2, type PhotoDocumentV2 } from '../catalog/photo-document-v2.ts';
import { createPhotoVersionV2 } from '../catalog/photo-history-v2.ts';
import type { PhotoDevelopV1, PhotoDocumentV1, PhotoMetadataV1 } from '../catalog/types.ts';
import { field, id, name, oneOf, record } from '../catalog/value-validation.ts';
import { PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_V2, applyPhotoDevelopWorkspaceCommandV2,
	applyLegacyPhotoDevelopToVersionV2, type PhotoDevelopWorkspaceCommandV2 } from './photo-develop-workspace-commands-v2.ts';

type Attributes = Pick<PhotoDocumentV1, 'rating' | 'flag' | 'colorLabel' | 'folderId' | 'keywordIds' | 'collectionIds'>;
export type PhotoCommandV2 =
	| PhotoDevelopWorkspaceCommandV2
	| Readonly<{ type: 'set-attributes'; changes: Readonly<Partial<Attributes>> }>
	| Readonly<{ type: 'set-metadata'; changes: Readonly<Partial<PhotoMetadataV1>> }>
	| Readonly<{ type: 'set-develop'; develop: PhotoDevelopV1 | ImageDevelopStateV2; versionId?: string }>
	| Readonly<{ type: 'create-virtual-copy'; id: string; name: string; createdAt: string; sourceVersionId?: string }>
	| Readonly<{ type: 'activate-version' | 'delete-virtual-copy'; versionId: string }>
	| Readonly<{ type: 'rename-virtual-copy'; versionId: string; name: string }>;

const ATTRIBUTE_FIELDS = ['rating', 'flag', 'colorLabel', 'folderId', 'keywordIds', 'collectionIds'];
const METADATA_FIELDS = ['fileName', 'modifiedTime', 'captureTime', 'orientation', 'cameraMake', 'cameraModel', 'lens',
	'exposureSeconds', 'aperture', 'iso', 'focalLengthMm', 'title', 'caption', 'creator', 'copyright', 'location'];
const COMMAND_TYPES = ['set-attributes', 'set-metadata', 'set-develop', 'create-virtual-copy',
	'activate-version', 'delete-virtual-copy', 'rename-virtual-copy', ...PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_V2] as const;

/** One inert authored-state draft; the repository and history own revision publication. */
export function applyPhotoCommandV2(value: unknown, command: unknown): PhotoDocumentV1 | PhotoDocumentV2 {
	const photo = readPhoto(value);
	const input = record(command, 'photo command', ['type', 'changes', 'develop', 'versionId', 'id', 'name', 'createdAt', 'sourceVersionId',
		'label', 'cursor', 'snapshotId'], ['type']);
	const type = oneOf(field(input, 'type'), COMMAND_TYPES, 'photo command type');
	if (PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_V2.some(candidate => candidate === type)) return applyPhotoDevelopWorkspaceCommandV2(photo, command);
	if (type === 'set-attributes' || type === 'set-metadata') {
		record(input, 'photo patch command', ['type', 'changes']);
		const changes = record(field(input, 'changes'), 'photo authored changes', type === 'set-attributes' ? ATTRIBUTE_FIELDS : METADATA_FIELDS, []);
		const patch = Object.fromEntries(Object.keys(changes).map((key) => [key, field(changes, key)]));
		return readPhoto(type === 'set-attributes' ? { ...photo, ...patch } : { ...photo, metadata: { ...photo.metadata, ...patch } });
	}
	if (type === 'create-virtual-copy') {
		record(input, 'photo virtual copy command', ['type', 'id', 'name', 'createdAt', 'sourceVersionId'], ['type', 'id', 'name', 'createdAt']);
		return createPhotoVersionV2(photo, {
			id: id(field(input, 'id'), 'virtual copy ID'), name: name(field(input, 'name'), 'virtual copy name'),
			createdAt: requiredText(field(input, 'createdAt'), 'virtual copy creation time'),
			...(Object.hasOwn(input, 'sourceVersionId') ? { sourceVersionId: id(field(input, 'sourceVersionId'), 'virtual copy source ID') } : {}),
		});
	}
	if (type === 'set-develop') {
		record(input, 'photo develop command', ['type', 'develop', 'versionId'], ['type', 'develop']);
		const versionId = Object.hasOwn(input, 'versionId') ? id(field(input, 'versionId'), 'develop version ID') : photo.activeVersionId;
		requireVersion(photo, versionId);
		const develop = normalizeImageDevelopStateV1OrV2(field(input, 'develop'));
		const aggregate = develop.processVersion === 2 ? upgradePhotoDocumentV2(photo) : photo;
		return readPhoto({ ...aggregate, versions: photo.versions.map((version) => version.id === versionId ? applyLegacyPhotoDevelopToVersionV2(version, develop) : version) });
	}
	record(input, 'photo version command', type === 'rename-virtual-copy' ? ['type', 'versionId', 'name'] : ['type', 'versionId']);
	const versionId = id(field(input, 'versionId'), 'photo command version ID');
	const version = requireVersion(photo, versionId);
	if (type === 'activate-version') return readPhoto({ ...photo, activeVersionId: versionId });
	if (version.kind !== 'virtual-copy') throw new RangeError('This command requires a virtual copy; the master is retained.');
	if (type === 'rename-virtual-copy') {
		const renamed = name(field(input, 'name'), 'virtual copy name');
		return readPhoto({ ...photo, versions: photo.versions.map((entry) => entry.id === versionId ? { ...entry, name: renamed } : entry) });
	}
	const master = photo.versions.find((entry) => entry.kind === 'master')!;
	return readPhoto({ ...photo, versions: photo.versions.filter((entry) => entry.id !== versionId),
		activeVersionId: photo.activeVersionId === versionId ? master.id : photo.activeVersionId });
}

function readPhoto(value: unknown): PhotoDocumentV1 | PhotoDocumentV2 {
	return normalizePhotoDocumentV1OrV2(value);
}

function requireVersion(photo: PhotoDocumentV1 | PhotoDocumentV2, versionId: string) {
	const version = photo.versions.find((entry) => entry.id === versionId);
	if (!version) throw new ReferenceError('The requested photo version is missing.');
	return version;
}

function requiredText(value: unknown, label: string): string {
	if (typeof value !== 'string') throw new TypeError(`${label} requires text.`);
	return value;
}
