/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateCurrentV1 } from '../../common/editor/imaging/image-develop-state-current-v1.ts';
import type { PhotoDocumentCurrentV1, PhotoVersionCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import type { PhotoDevelopWorkspaceCommandV2 } from './photo-develop-workspace-commands-v2.ts';
import { PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_KERNEL, normalizePhotoDevelopWorkspaceCommandForProfileV1,
	applyPhotoDevelopWorkspaceCommandForProfileV1, applyLegacyPhotoDevelopToVersionForProfileV1 } from './photo-develop-workspace-commands-kernel.ts';

export const PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_CURRENT_V1 = PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_KERNEL;
export type PhotoDevelopWorkspaceCommandCurrentV1 = Exclude<PhotoDevelopWorkspaceCommandV2, { type: 'record-develop' }>
	| Readonly<{ type: 'record-develop'; versionId?: string; develop: ImageDevelopStateCurrentV1; label: string; createdAt: string }>;

export function normalizePhotoDevelopWorkspaceCommandCurrentV1(command: unknown): PhotoDevelopWorkspaceCommandCurrentV1 {
	return normalizePhotoDevelopWorkspaceCommandForProfileV1('current3', command);
}
export function applyPhotoDevelopWorkspaceCommandCurrentV1(value: unknown, command: unknown): PhotoDocumentCurrentV1 {
	return applyPhotoDevelopWorkspaceCommandForProfileV1('current3', value, command);
}
export function applyLegacyPhotoDevelopToVersionCurrentV1(version: PhotoVersionCurrentV1, develop: ImageDevelopStateCurrentV1): PhotoVersionCurrentV1 {
	return applyLegacyPhotoDevelopToVersionForProfileV1('current3', version, develop);
}
