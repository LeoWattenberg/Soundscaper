/* SPDX-License-Identifier: AGPL-3.0-only */

import { photoStorageKey } from './repository-records.ts';
import { normalizePhotoStackV1, PHOTO_STACK_LIMITS_V1, type PhotoStackV1 } from './photo-stack-v1.ts';
import { array, field, record } from './value-validation.ts';

export const PHOTO_STACK_RECORD_LIMITS_V1 = Object.freeze({ maximumBytes: 512 * 1024 });
export interface PhotoStackRecordV1 {
	readonly key: string;
	readonly catalogId: string;
	readonly memberKeys: readonly string[];
	readonly document: Readonly<PhotoStackV1>;
}

/** Private IndexedDB projection; portable stack documents retain their closed v1 shape. */
export function photoStackRecordV1(value: unknown): Readonly<PhotoStackRecordV1> {
	const document = normalizePhotoStackV1(value);
	const result = Object.freeze({ key: photoStorageKey(document.catalogId, document.id), catalogId: document.catalogId,
		memberKeys: Object.freeze(document.photoIds.map(photoId => photoStorageKey(document.catalogId, photoId))), document });
	checkBudget(result); return result;
}
export function readPhotoStackRecordV1(value: unknown, catalogId: string, key: IDBValidKey): Readonly<PhotoStackV1> {
	const input = record(value, 'stored photo stack', ['key', 'catalogId', 'memberKeys', 'document']);
	const stack = normalizePhotoStackV1(field(input, 'document'));
	if (field(input, 'key') !== key || field(input, 'catalogId') !== catalogId || stack.catalogId !== catalogId
		|| key !== photoStorageKey(catalogId, stack.id)) throw new TypeError('Stored stack identity disagrees with its key.');
	const members = array(field(input, 'memberKeys'), 'stored stack forward membership', 2, PHOTO_STACK_LIMITS_V1.maximumPhotos);
	const memberKeys = stack.photoIds.map(photoId => photoStorageKey(catalogId, photoId));
	if (members.length !== memberKeys.length || members.some((member, index) => member !== memberKeys[index])) {
		throw new TypeError('Stored stack forward membership projection disagrees with its ordered document.');
	}
	checkBudget({ key: photoStorageKey(catalogId, stack.id), catalogId, memberKeys, document: stack });
	return stack;
}
function checkBudget(value: PhotoStackRecordV1): void {
	if (new TextEncoder().encode(JSON.stringify(value)).byteLength > PHOTO_STACK_RECORD_LIMITS_V1.maximumBytes) {
		throw new RangeError('Stored stack record exceeds its 512 KiB budget.');
	}
}
