/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeImageDevelopStateThroughV3, type ImageDevelopStateThroughV3 } from '../../common/editor/imaging/image-develop-state-through-v3.ts';
import type { PhotoDocumentV1, PhotoVersionV1 } from './types.ts';
import { normalizePhotoDevelopWorkspaceThroughV3, type PhotoDevelopWorkspaceThroughV3 } from './photo-develop-workspace-through-v3.ts';
import { normalizePhotoDocumentForPolicyV3 } from './internal/photo-document-kernel-v3.ts';

export interface PhotoVersionV3 extends Omit<PhotoVersionV1, 'develop' | 'workspace'> {
	readonly develop: ImageDevelopStateThroughV3;
	readonly workspace?: PhotoDevelopWorkspaceThroughV3;
}
/** Permanent Photo3 reader retains its process-through3 admission policy. */
export interface PhotoDocumentV3 extends Omit<PhotoDocumentV1, 'schemaVersion' | 'versions'> {
	readonly schemaVersion: 3;
	readonly versions: readonly PhotoVersionV3[];
}
export function normalizePhotoDocumentV3(value: unknown): PhotoDocumentV3 {
	return normalizePhotoDocumentForPolicyV3(value, normalizeImageDevelopStateThroughV3, normalizePhotoDevelopWorkspaceThroughV3);
}
