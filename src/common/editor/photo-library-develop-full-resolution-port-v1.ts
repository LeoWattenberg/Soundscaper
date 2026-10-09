/* SPDX-License-Identifier: AGPL-3.0-only */

/** Full-resolution UNORM8 sRGB admission is separate from the unchanged proxy profile.
 * Natural geometry may enlarge the output; one named profile bounds it before allocation. */
export const PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 = Object.freeze({
	source: Object.freeze({ maximumSidePixels: 8192, maximumPixels: 16_777_216, maximumBytes: 67_108_864 }),
	render: Object.freeze({ maximumSidePixels: 16_384, maximumPixels: 67_108_864, maximumBytes: 268_435_456 }),
});

export type PhotoDevelopResolutionV1 = 'proxy' | 'full';
