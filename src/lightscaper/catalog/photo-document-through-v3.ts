/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDocumentV1OrV2, type PhotoDocumentV2 } from './photo-document-v2.ts';
import { normalizePhotoDocumentV3, type PhotoDocumentV3 } from './photo-document-v3.ts';
import type { PhotoDocumentV1 } from './types.ts';
import { field } from './value-validation.ts';

export type PhotoDocumentThroughV3 = PhotoDocumentV1 | PhotoDocumentV2 | PhotoDocumentV3;
/** Permanent aggregate3 admission checks every retained recipe and workspace. */
export function normalizePhotoDocumentThroughV3(value: unknown): PhotoDocumentThroughV3 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Photo requires an own document version.');
	return field(value as Readonly<Record<string, unknown>>, 'schemaVersion') === 3 ? normalizePhotoDocumentV3(value) : normalizePhotoDocumentV1OrV2(value);
}
