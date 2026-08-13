/* SPDX-License-Identifier: AGPL-3.0-only */

export const VIDEO_PREVIEW_MAXIMUM_RENDER_DIMENSION = 4_096;

/** Admit an exact compositor output axis before any render-target allocation. */
export function exactVideoPreviewRenderDimension(value, name) {
	if (!Number.isSafeInteger(value) || value < 1
		|| value > VIDEO_PREVIEW_MAXIMUM_RENDER_DIMENSION) {
		throw new RangeError(
			`Video compositor output ${name} must be an integer from 1 through `
			+ `${VIDEO_PREVIEW_MAXIMUM_RENDER_DIMENSION}.`,
		);
	}
	return value;
}
