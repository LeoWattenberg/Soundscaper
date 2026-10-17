/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PreparedNoiseReductionEffectV1 } from '../video-noise-reduction-v1.ts';
import { linearKernelEncodedV1 as encoded } from './linear-kernel-planes-v1.ts';
import { LINEAR_BINOMIAL5_V1, linearSpatialOffsetV1, linearSpatialUnitV1 } from './linear-spatial-neighborhood-v1.ts';

interface Channels { red: number; green: number; blue: number; }

/** Continuous encoded YCoCg keeps both strengths on the same original input.
 * Only edge/detail/protection weights clamp. Authored Q8 gains stay unchanged;
 * no reversible-integer lifting or rounded neighborhood mean quantizes RGB. */
export function writeLinearSpatialNoiseV1(p: PreparedNoiseReductionEffectV1, source: Float32Array<ArrayBuffer>, width: number, height: number,
	x: number, y: number, red: number, green: number, blue: number, target: Channels): void {
	const co = red - blue, t = (red + blue) / 2, cg = green - t, luma = t + cg / 2;
	let nextY = luma, nextCo = co, nextCg = cg;
	if (p.luminanceQ8 !== 0) {
		let sum = 0, weight = 0, minimum = luma, maximum = luma;
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
			const offset = linearSpatialOffsetV1(width, height, x + dx, y + dy), alpha = source[offset + 3]!;
			if (alpha === 0) continue;
			const r = encoded(source[offset]!), g = encoded(source[offset + 1]!), b = encoded(source[offset + 2]!);
			const ny = (r + b) / 4 + g / 2;
			minimum = Math.min(minimum, ny); maximum = Math.max(maximum, ny);
			const w = alpha * (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1) * Math.max(0, 16 - Math.abs(ny - luma) * 255 * p.luminanceDetailQ8 / 256);
			weight += w; sum += w * ny;
		}
		if (weight > 0) {
			const protection = p.luminanceContrastQ8 / 256 * linearSpatialUnitV1(maximum - minimum);
			nextY += (sum / weight - luma) * p.luminanceQ8 / 256 * (1 - protection);
		}
	}
	if (p.colorQ8 !== 0) {
		let sumCo = 0, sumCg = 0, weight = 0;
		for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
			const inner = Math.abs(dx) <= 1 && Math.abs(dy) <= 1 ? (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1) : 0;
			const spatial = inner * 16 * (1 - p.colorSmoothnessQ8 / 256) + LINEAR_BINOMIAL5_V1[dx + 2]! * LINEAR_BINOMIAL5_V1[dy + 2]! * p.colorSmoothnessQ8 / 256;
			if (spatial === 0) continue;
			const offset = linearSpatialOffsetV1(width, height, x + dx, y + dy), alpha = source[offset + 3]!;
			if (alpha === 0) continue;
			const r = encoded(source[offset]!), g = encoded(source[offset + 1]!), b = encoded(source[offset + 2]!);
			const nco = r - b, ncg = g - (r + b) / 2;
			const distance = Math.max(Math.abs(nco - co), Math.abs(ncg - cg));
			const w = spatial * alpha * Math.max(0, 16 - distance * 255 * p.colorDetailQ8 / 256);
			weight += w; sumCo += w * nco; sumCg += w * ncg;
		}
		if (weight > 0) { nextCo += (sumCo / weight - co) * p.colorQ8 / 256; nextCg += (sumCg / weight - cg) * p.colorQ8 / 256; }
	}
	// Keep exact inactive/edge-protected channels without an avoidable transform round trip.
	if (nextY === luma && nextCo === co && nextCg === cg) { target.red = red; target.green = green; target.blue = blue; return; }
	const nextT = nextY - nextCg / 2;
	target.blue = nextT - nextCo / 2; target.red = target.blue + nextCo; target.green = nextCg + nextT;
}
