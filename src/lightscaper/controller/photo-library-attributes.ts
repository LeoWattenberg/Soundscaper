/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryAttributePatchV1 } from '../../common/editor/photo-library-session-port-v1.ts';
import { field, integer, oneOf, record } from '../catalog/value-validation.ts';

export function normalizePhotoLibraryAttributesV1(value: unknown): PhotoLibraryAttributePatchV1 {
	const input = record(value, 'photo attributes', ['rating', 'flag', 'colorLabel'], []);
	if (Object.keys(input).length === 0) throw new RangeError('Photo attribute patch is empty.');
	return Object.freeze({
		...(Object.hasOwn(input, 'rating') ? { rating: integer(field(input, 'rating'), 0, 5, 'photo rating') } : {}),
		...(Object.hasOwn(input, 'flag') ? { flag: oneOf(field(input, 'flag'), ['unflagged', 'pick', 'reject'] as const, 'photo flag') } : {}),
		...(Object.hasOwn(input, 'colorLabel') ? { colorLabel: oneOf(field(input, 'colorLabel'), ['none', 'red', 'yellow', 'green', 'blue', 'purple'] as const, 'photo color label') } : {}),
	});
}
