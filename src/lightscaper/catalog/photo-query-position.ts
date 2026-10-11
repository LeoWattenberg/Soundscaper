/* SPDX-License-Identifier: AGPL-3.0-only */

import { array, field, id, integer, localTimestamp, record, text } from './value-validation.ts';
import type { PhotoCatalogQueryV1 } from './photo-query-types-v1.ts';

/** Internal seek derived from an admitted point row in the current native transaction. */
export interface PhotoQueryInclusivePosition {
	readonly captureBucket: 0 | 1;
	readonly key: readonly (string | number)[];
}

/** Shared physical seek grammar; callers own their separate protocol identities. */
export function readPhotoQueryPosition(value: unknown, catalog: string, sort: PhotoCatalogQueryV1['sort']['field']) {
	const input = record(value, 'photo query position', ['captureBucket', 'afterKey']);
	const bucket = integer(field(input, 'captureBucket'), 0, 1, 'capture bucket') as 0 | 1;
	if (sort !== 'capture-time' && bucket !== 0) throw new TypeError('Query continuation has an invalid capture bucket.');
	const afterValue = field(input, 'afterKey');
	let afterKey: readonly (string | number)[] | null = null;
	if (afterValue !== null) {
		const length = sort === 'photo-id' ? 2 : sort === 'capture-time' ? 4 : 3;
		const parts = array(afterValue, 'query continuation key', length, length);
		if (parts[0] !== catalog) throw new TypeError('Query continuation key belongs to another catalog.');
		const photo = id(parts.at(-1), 'continuation photo ID');
		if (sort === 'photo-id') afterKey = Object.freeze([catalog, photo]);
		else if (sort === 'rating') afterKey = Object.freeze([catalog, integer(parts[1], 0, 5, 'continuation rating'), photo]);
		else if (sort === 'file-name') afterKey = Object.freeze([catalog, text(parts[1], 'continuation filename', 512), photo]);
		else {
			if (parts[1] !== bucket) throw new TypeError('Query continuation capture bucket disagrees.');
			const capture = bucket === 0 ? localTimestamp(parts[2], 'continuation capture') : parts[2];
			if (bucket === 1 && capture !== '') throw new TypeError('Unknown capture continuation cannot invent a date.');
			afterKey = Object.freeze([catalog, bucket, capture as string, photo]);
		}
	}
	return Object.freeze({ captureBucket: bucket, afterKey });
}
