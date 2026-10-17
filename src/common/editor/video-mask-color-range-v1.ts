/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoColorRangeMaskNodeV1 } from './video-mask-matte-v24.ts';
import type { CapturedVideoMaskLuminanceFrameV1 } from './video-mask-luminance-range-v1.ts';

/** Fixed encoded-sRGB target; decode once for this evaluated node and retain
 * only scalar channels beside the existing privately captured RGBA frame. */
export function prepareVideoMaskColorRangeCoverageV1(node: Readonly<VideoColorRangeMaskNodeV1>,
	frame: Readonly<CapturedVideoMaskLuminanceFrameV1>): (pixelIndex: number) => number {
	const red = decode(node.color.r), green = decode(node.color.g), blue = decode(node.color.b);
	const pixels = frame.pixels, linear = frame.transfer === 'linear';
	return pixelIndex => {
		const offset = pixelIndex * 4;
		if (pixels[offset + 3] === 0) return 0;
		const r = sample(pixels[offset]!, linear) - red, g = sample(pixels[offset + 1]!, linear) - green;
		const b = sample(pixels[offset + 2]!, linear) - blue;
		const distance = Math.sqrt((r * r + g * g + b * b) / 3);
		if (distance <= node.radius) return 255;
		if (node.falloff === 0) return 0;
		return Math.round(255 * Math.max(0, Math.min(1, 1 - (distance - node.radius) / node.falloff)));
	};
}

function sample(byte: number, linear: boolean): number {
	const value = byte / 255; return linear ? value : decode(value);
}
function decode(value: number): number {
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
