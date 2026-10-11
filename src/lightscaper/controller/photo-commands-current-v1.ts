/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateCurrentV1 } from '../../common/editor/imaging/image-develop-state-current-v1.ts';
import type { PhotoDocumentCurrentV1 } from '../catalog/photo-document-current-v1.ts';
import type { PhotoCommandV2 } from './photo-commands-v2.ts';
import type { PhotoDevelopWorkspaceCommandV2 } from './photo-develop-workspace-commands-v2.ts';
import type { PhotoDevelopWorkspaceCommandCurrentV1 } from './photo-develop-workspace-commands-current-v1.ts';
import { applyPhotoCommandForProfileV1 } from './photo-commands-kernel.ts';

export type PhotoCommandCurrentV1 = Exclude<PhotoCommandV2, PhotoDevelopWorkspaceCommandV2 | { type: 'set-develop' }>
	| PhotoDevelopWorkspaceCommandCurrentV1
	| Readonly<{ type: 'set-develop'; develop: ImageDevelopStateCurrentV1; versionId?: string }>;

export function applyPhotoCommandCurrentV1(value: unknown, command: unknown): PhotoDocumentCurrentV1 {
	return applyPhotoCommandForProfileV1('current3', value, command);
}
