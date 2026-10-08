/* SPDX-License-Identifier: AGPL-3.0-only */

import { PHOTO_SMART_COLLECTION_LIMITS_V1 } from './photo-smart-collection-v1.ts';
import { field, id, integer, record } from './value-validation.ts';

/** Retain this scalar authority after the last deletion so CAS revisions cannot reset. */
export interface PhotoSmartCollectionsStateV1 {
	readonly schemaVersion: 1;
	readonly kind: 'photo-smart-collections-state';
	readonly catalogId: string;
	readonly revision: number;
	readonly collectionCount: number;
}
export function normalizePhotoSmartCollectionsStateV1(value: unknown): Readonly<PhotoSmartCollectionsStateV1> {
	const input = record(value, 'photo smart collections state', ['schemaVersion', 'kind', 'catalogId', 'revision', 'collectionCount']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported or future photo smart collections state version.');
	if (field(input, 'kind') !== 'photo-smart-collections-state') throw new TypeError('Unexpected photo smart collections state kind.');
	return Object.freeze({ schemaVersion: 1, kind: 'photo-smart-collections-state',
		catalogId: id(field(input, 'catalogId'), 'smart collections catalog ID'),
		revision: integer(field(input, 'revision'), 0, Number.MAX_SAFE_INTEGER, 'smart collections state revision'),
		collectionCount: integer(field(input, 'collectionCount'), 0, PHOTO_SMART_COLLECTION_LIMITS_V1.maximumCollections, 'smart collection count') });
}

export function serializePhotoSmartCollectionsStateV1(value: unknown): string {
	return JSON.stringify(normalizePhotoSmartCollectionsStateV1(value));
}
