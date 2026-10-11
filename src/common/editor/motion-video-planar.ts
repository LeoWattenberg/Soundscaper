/* SPDX-License-Identifier: AGPL-3.0-only */
import { encodeMotionChannel, validateMotionSurface, type MotionSurface } from './motion-surface.ts';
import type { MotionVideoBackground } from './motion-video-delivery.ts';

/** BT.709 limited-range 8-bit Y/Cb/Cr, 4:2:0 box chroma. Keep the matrix in our
 * authority: browser RGBA encoders can silently convert with BT.601 coefficients.
 * Flatten alpha in linear light before transfer encoding and chroma subsampling.
 */
export function motionVideoI420Pixels(surface: MotionSurface, background: MotionVideoBackground): Uint8Array<ArrayBuffer> {
	validateMotionSurface(surface);
	if (background.length !== 3 || background.some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new TypeError('Video background must be a linear SDR color.');
	const { width, height, pixels } = surface;
	const chromaWidth = Math.ceil(width / 2), chromaHeight = Math.ceil(height / 2);
	const uOffset = width * height, vOffset = uOffset + chromaWidth * chromaHeight;
	const bytes = new Uint8Array(vOffset + chromaWidth * chromaHeight);
	for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
		let u = 0, v = 0, count = 0;
		for (let dy = 0; dy < 2 && y + dy < height; dy++) for (let dx = 0; dx < 2 && x + dx < width; dx++) {
			const at = (y + dy) * width + x + dx, pixel = at * 4, remaining = 1 - pixels[pixel + 3]!;
			const r = encodeMotionChannel(Math.min(1, pixels[pixel]! + background[0] * remaining), 'rec709');
			const g = encodeMotionChannel(Math.min(1, pixels[pixel + 1]! + background[1] * remaining), 'rec709');
			const b = encodeMotionChannel(Math.min(1, pixels[pixel + 2]! + background[2] * remaining), 'rec709');
			const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
			bytes[at] = code(16 + 219 * luma, 16, 235);
			u += (b - luma) / 1.8556; v += (r - luma) / 1.5748; count++;
		}
		const chroma = (y / 2) * chromaWidth + x / 2;
		bytes[uOffset + chroma] = code(128 + 224 * u / count, 16, 240);
		bytes[vOffset + chroma] = code(128 + 224 * v / count, 16, 240);
	}
	return bytes;
}
function code(value: number, minimum: number, maximum: number): number { return Math.max(minimum, Math.min(maximum, Math.round(value))); }
