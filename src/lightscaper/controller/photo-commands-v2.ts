/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ImageDevelopStateV2 } from '../../common/editor/imaging/image-develop-state-v2.ts';
import type { PhotoDocumentV2 } from '../catalog/photo-document-v2.ts';
import type { PhotoDevelopV1, PhotoDocumentV1, PhotoMetadataV1 } from '../catalog/types.ts';
import type { PhotoDevelopWorkspaceCommandV2 } from './photo-develop-workspace-commands-v2.ts';
import { applyPhotoCommandForProfileV1 } from './photo-commands-kernel.ts';

type Attributes = Pick<PhotoDocumentV1, 'rating' | 'flag' | 'colorLabel' | 'folderId' | 'keywordIds' | 'collectionIds'>;
export type PhotoCommandV2 =
	| PhotoDevelopWorkspaceCommandV2
	| Readonly<{ type: 'set-attributes'; changes: Readonly<Partial<Attributes>> }>
	| Readonly<{ type: 'set-metadata'; changes: Readonly<Partial<PhotoMetadataV1>> }>
	| Readonly<{ type: 'set-develop'; develop: PhotoDevelopV1 | ImageDevelopStateV2; versionId?: string }>
	| Readonly<{ type: 'create-virtual-copy'; id: string; name: string; createdAt: string; sourceVersionId?: string }>
	| Readonly<{ type: 'activate-version' | 'delete-virtual-copy'; versionId: string }>
	| Readonly<{ type: 'rename-virtual-copy'; versionId: string; name: string }>;

/** Permanently fixed legacy2 admission. */
export function applyPhotoCommandV2(value: unknown, command: unknown): PhotoDocumentV1 | PhotoDocumentV2 {
	return applyPhotoCommandForProfileV1('legacy2', value, command);
}
