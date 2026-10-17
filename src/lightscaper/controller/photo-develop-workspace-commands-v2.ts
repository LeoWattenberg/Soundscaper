/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import type { PhotoDocumentV2, PhotoVersionV2 } from '../catalog/photo-document-v2.ts';
import type { PhotoDevelopV1, PhotoDocumentV1 } from '../catalog/types.ts';
import { PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_KERNEL, normalizePhotoDevelopWorkspaceCommandForProfileV1,
	applyPhotoDevelopWorkspaceCommandForProfileV1, applyLegacyPhotoDevelopToVersionForProfileV1 } from './photo-develop-workspace-commands-kernel.ts';

export const PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_V2 = PHOTO_DEVELOP_WORKSPACE_COMMAND_TYPES_KERNEL;
export type PhotoDevelopWorkspaceCommandV2 =
	| Readonly<{ type: 'record-develop'; versionId?: string; develop: PhotoDevelopV1 | ImageDevelopStateV2; label: string; createdAt: string }>
	| Readonly<{ type: 'select-develop-history'; versionId?: string; cursor: number }>
	| Readonly<{ type: 'save-develop-snapshot'; versionId?: string; id: string; name: string; createdAt: string }>
	| Readonly<{ type: 'delete-develop-snapshot'; versionId?: string; snapshotId: string }>
	| Readonly<{ type: 'restore-develop-snapshot'; versionId?: string; snapshotId: string; label: string; createdAt: string }>;

export function normalizePhotoDevelopWorkspaceCommandV2(command: unknown): PhotoDevelopWorkspaceCommandV2 {
	return normalizePhotoDevelopWorkspaceCommandForProfileV1('legacy2', command);
}
export function applyPhotoDevelopWorkspaceCommandV2(value: unknown, command: unknown): PhotoDocumentV1 | PhotoDocumentV2 {
	return applyPhotoDevelopWorkspaceCommandForProfileV1('legacy2', value, command);
}
export function applyLegacyPhotoDevelopToVersionV2(version: PhotoVersionV2, develop: PhotoDevelopV1 | ImageDevelopStateV2): PhotoVersionV2 {
	return applyLegacyPhotoDevelopToVersionForProfileV1('legacy2', version, develop);
}
