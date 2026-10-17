/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDocumentV1OrV2 } from './photo-document-v2.ts';
import { photoStorageKey } from './repository-records.ts';
import { field, record } from './value-validation.ts';

/** Physical requested keys and the inline wrapper must bind the same admitted document. */
export function readStoredPhotoV1OrV2(value: unknown, expectedKey?: string) {
	const input = record(value, 'stored current photo', ['key', 'document']);
	const photo = normalizePhotoDocumentV1OrV2(field(input, 'document'));
	const key = photoStorageKey(photo.catalogId, photo.id);
	if (field(input, 'key') !== key || (expectedKey !== undefined && expectedKey !== key)) {
		throw new TypeError('Stored photo key disagrees with its requested document.');
	}
	return photo;
}
