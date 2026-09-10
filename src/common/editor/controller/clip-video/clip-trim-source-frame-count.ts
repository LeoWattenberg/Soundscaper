/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ClipTransformSource } from './internal/clip/clip-domain-types.ts';

/** Video stores sampleFrameCount; command adapters may retain its frameCount alias. */
export function clipTrimSourceFrameCount(source: ClipTransformSource): number {
	const count = source.sampleFrameCount ?? source.frameCount;
	if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) {
		throw new TypeError('Clip trimming requires a finite source frame count.');
	}
	return count;
}
