/* SPDX-License-Identifier: AGPL-3.0-only */
import { encodeMotionChannel, validateMotionSurface, type MotionSurface } from './motion-surface.ts';
import { videoI420Pixels } from './video-planar-pixels.ts';
import type { MotionVideoBackground } from './motion-video-delivery.ts';

/** BT.709 limited-range 8-bit Y/Cb/Cr, 4:2:0 box chroma. Keep the matrix in our
 * authority: browser RGBA encoders can silently convert with BT.601 coefficients.
 * Flatten alpha in linear light before transfer encoding and chroma subsampling.
 */
export function motionVideoI420Pixels(surface: MotionSurface, background: MotionVideoBackground): Uint8Array<ArrayBuffer> {
	validateMotionSurface(surface);
	if (background.length !== 3 || background.some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new TypeError('Video background must be a linear SDR color.');
	const { width, height, pixels } = surface;
	return videoI420Pixels(width, height, (at, rgb) => {
		const pixel = at * 4, remaining = 1 - pixels[pixel + 3]!;
		for (let c = 0; c < 3; c++) rgb[c] = encodeMotionChannel(Math.min(1, pixels[pixel + c]! + background[c]! * remaining), 'rec709');
	});
}
