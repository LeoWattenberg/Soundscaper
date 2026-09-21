/* SPDX-License-Identifier: AGPL-3.0-only */

interface GrayVideoFrameSamplesV1 {
	readonly width: number;
	readonly height: number;
	readonly samples: ArrayLike<number>;
}

/** Sample a gray frame with edge-clamped bilinear interpolation. */
export function sampleGrayVideoFrameBilinearV1(
	frame: GrayVideoFrameSamplesV1,
	x: number,
	y: number,
): number {
	const x0 = Math.max(0, Math.min(frame.width - 1, Math.floor(x)));
	const y0 = Math.max(0, Math.min(frame.height - 1, Math.floor(y)));
	const x1 = Math.min(frame.width - 1, x0 + 1);
	const y1 = Math.min(frame.height - 1, y0 + 1);
	const mixX = Math.max(0, Math.min(1, x - x0));
	const mixY = Math.max(0, Math.min(1, y - y0));
	const topLeft = frame.samples[y0 * frame.width + x0]!;
	const topRight = frame.samples[y0 * frame.width + x1]!;
	const bottomLeft = frame.samples[y1 * frame.width + x0]!;
	const bottomRight = frame.samples[y1 * frame.width + x1]!;
	const top = topLeft + (topRight - topLeft) * mixX;
	const bottom = bottomLeft + (bottomRight - bottomLeft) * mixX;
	return top + (bottom - top) * mixY;
}
