/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeLinearKernelPixelV1 } from './linear-kernel-planes-v1.ts';

export interface LinearRepairSampleV1 { red: number; green: number; blue: number; alpha: number; }

/** Missing taps are transparent; native linear RGB is alpha-premultiplied
 * only for bilinear filtering and unpremultiplied once for the returned sample. */
export function sampleLinearRepairDonorV1(original: Float32Array<ArrayBuffer>, width: number, height: number,
	x: number, y: number, sample: LinearRepairSampleV1): void {
	const left = Math.floor(x - 0.5), top = Math.floor(y - 0.5), fx = x - 0.5 - left, fy = y - 0.5 - top;
	let alpha = 0, red = 0, green = 0, blue = 0;
	for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
		const sx = left + dx, sy = top + dy;
		if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
		const offset = (sy * width + sx) * 4;
		const weight = (dx === 0 ? 1 - fx : fx) * (dy === 0 ? 1 - fy : fy) * original[offset + 3]!;
		if (weight === 0) continue;
		alpha += weight; red += original[offset]! * weight; green += original[offset + 1]! * weight; blue += original[offset + 2]! * weight;
	}
	sample.alpha = alpha; sample.red = alpha === 0 ? 0 : red / alpha;
	sample.green = alpha === 0 ? 0 : green / alpha; sample.blue = alpha === 0 ? 0 : blue / alpha;
}

/** Clamp coverage alone. Exact endpoints and stable weighted sums retain tiny,
 * signed and HDR RGB without a transfer round trip or byte quantization. */
export function blendLinearRepairSampleV1(output: Float32Array<ArrayBuffer>, offset: number,
	sample: LinearRepairSampleV1, amount: number): void {
	if (output[offset + 3] === 0 || sample.alpha === 0 || amount === 0) return;
	const weight = Math.max(0, Math.min(1, amount * sample.alpha));
	if (weight === 0) return;
	const before = 1 - weight;
	writeLinearKernelPixelV1(output, offset, weight === 1 ? sample.red : before * output[offset]! + weight * sample.red,
		weight === 1 ? sample.green : before * output[offset + 1]! + weight * sample.green,
		weight === 1 ? sample.blue : before * output[offset + 2]! + weight * sample.blue, output[offset + 3]!);
}
