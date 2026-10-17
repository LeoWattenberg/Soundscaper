/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoDocumentV1, PhotoVersionV1 } from './types.ts';
import { normalizePhotoDocumentV1OrV2, type PhotoDocumentV2, type PhotoVersionV2 } from './photo-document-v2.ts';
import { normalizePhotoDocumentV3, type PhotoDocumentV3 } from './photo-document-v3.ts';
import { normalizePhotoDocumentProfileCurrentV3, type PhotoDocumentProfileCurrentV3, type PhotoVersionProfileCurrentV3 } from './photo-document-profile-current-v3.ts';
import { assertPhotoDocumentByteBudgetV1, canonicalPhotoDocumentJsonV1 } from './photo-document-json-v1.ts';
import { field } from './value-validation.ts';

export type PhotoDocumentCurrentV1 = PhotoDocumentV1 | PhotoDocumentV2 | PhotoDocumentProfileCurrentV3;
export type PhotoVersionCurrentV1 = PhotoVersionV1 | PhotoVersionV2 | PhotoVersionProfileCurrentV3;
/** Select the strict owner from inert native own data; loading never promotes. */
export function normalizePhotoDocumentCurrentV1(value: unknown): PhotoDocumentCurrentV1 {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Photo requires an own document version.');
	const version = field(value as Readonly<Record<string, unknown>>, 'schemaVersion');
	if (version === 1 || version === 2) return normalizePhotoDocumentV1OrV2(value);
	if (version === 3) return normalizePhotoDocumentProfileCurrentV3(value);
	throw new RangeError('Unsupported photo document version.');
}
export function parsePhotoDocumentCurrentV1(value: string): PhotoDocumentCurrentV1 {
	if (typeof value !== 'string') throw new TypeError('Photo document requires JSON text.');
	assertPhotoDocumentByteBudgetV1(value);
	const parsed: unknown = JSON.parse(value); return normalizePhotoDocumentCurrentV1(parsed);
}
export function serializePhotoDocumentCurrentV1(value: unknown): string {
	const text = canonicalPhotoDocumentJsonV1(normalizePhotoDocumentCurrentV1(value));
	assertPhotoDocumentByteBudgetV1(text); return text;
}
/** Only an explicit current edit requests aggregate3. Old recipes remain exact. */
export function upgradePhotoDocumentV3(value: unknown): PhotoDocumentV3 {
	const photo = normalizePhotoDocumentCurrentV1(value);
	return normalizePhotoDocumentV3({ ...photo, schemaVersion: 3 });
}
/** Explicit Current aggregate promotion retains source-processing metadata. */
export function upgradePhotoDocumentCurrentV1(value: unknown): PhotoDocumentProfileCurrentV3 {
	return normalizePhotoDocumentProfileCurrentV3({ ...normalizePhotoDocumentCurrentV1(value), schemaVersion: 3 });
}
