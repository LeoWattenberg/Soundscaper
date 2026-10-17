/* SPDX-License-Identifier: AGPL-3.0-only */

import { field, oneOf, record } from './image-develop-value.ts';

export type ImageDevelopRawDevelopmentModeV1 = 'canonical' | 'headroom' | 'recovery';
/** Fixed source processing metadata; no native settings or pixel authority. */
export interface ImageDevelopRawDevelopmentV1 {
	readonly schemaVersion: 1;
	readonly mode: ImageDevelopRawDevelopmentModeV1;
}

/** Canonical selects the existing Original producer. Headroom and recovery
 * select their fixed native profiles only after an owner authenticates RAW
 * bytes; scalar admission does not establish source/layout support. */
export function normalizeImageDevelopRawDevelopmentV1(value: unknown): Readonly<ImageDevelopRawDevelopmentV1> {
	const input = record(value, 'RAW development', ['schemaVersion', 'mode']);
	if (field(input, 'schemaVersion') !== 1) throw new RangeError('Unsupported RAW development version.');
	return Object.freeze({ schemaVersion: 1, mode: oneOf(field(input, 'mode'),
		['canonical', 'headroom', 'recovery'] as const, 'RAW development mode') });
}
