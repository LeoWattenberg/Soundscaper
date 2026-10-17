/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizePhotoDocumentCurrentV1 } from './photo-document-current-v1.ts';
import { photoStorageKey } from './repository-records.ts';
import { field, record } from './value-validation.ts';

/** The native key and inline wrapper bind the genuine current aggregate. */
export function readStoredPhotoCurrentV1(value: unknown, expectedKey?: string) {
	const input = record(value, 'stored current photo', ['key', 'document']);
	const photo = normalizePhotoDocumentCurrentV1(field(input, 'document'));
	const key = photoStorageKey(photo.catalogId, photo.id);
	if (field(input, 'key') !== key || (expectedKey !== undefined && expectedKey !== key)) {
		throw new TypeError('Stored photo key disagrees with its requested document.');
	}
	return photo;
}
