/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopStateThroughV4, type ImageDevelopStateThroughV4 } from '../../common/editor/imaging/image-develop-state-v4.ts';
import type { PhotoDocumentV1, PhotoVersionV1 } from './types.ts';
import { normalizePhotoDevelopWorkspaceCurrentV1, type PhotoDevelopWorkspaceCurrentV1 } from './photo-develop-workspace-current-v1.ts';
import { normalizePhotoDocumentForPolicyV3 } from './internal/photo-document-kernel-v3.ts';

export interface PhotoVersionProfileCurrentV3 extends Omit<PhotoVersionV1, 'develop' | 'workspace'> {
	readonly develop: ImageDevelopStateThroughV4;
	readonly workspace?: PhotoDevelopWorkspaceCurrentV1;
}
/** New nested processing metadata uses the existing Photo3 aggregate wire. */
export interface PhotoDocumentProfileCurrentV3 extends Omit<PhotoDocumentV1, 'schemaVersion' | 'versions'> {
	readonly schemaVersion: 3;
	readonly versions: readonly PhotoVersionProfileCurrentV3[];
}
export function normalizePhotoDocumentProfileCurrentV3(value: unknown): PhotoDocumentProfileCurrentV3 {
	return normalizePhotoDocumentForPolicyV3(value, normalizeImageDevelopStateThroughV4, normalizePhotoDevelopWorkspaceCurrentV1);
}
