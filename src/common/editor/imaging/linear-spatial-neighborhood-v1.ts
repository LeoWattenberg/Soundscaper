/* SPDX-License-Identifier: AGPL-3.0-only */
import { linearKernelEncodedV1 as encoded } from './linear-kernel-planes-v1.ts';

export const LINEAR_BINOMIAL3_V1 = Object.freeze([1, 2, 1]);
export const LINEAR_BINOMIAL5_V1 = Object.freeze([1, 4, 6, 4, 1]);
export const LINEAR_BINOMIAL7_V1 = Object.freeze([1, 6, 15, 20, 15, 6, 1]);
export function linearSpatialLumaV1(red: number, green: number, blue: number): number { return (54 * red + 183 * green + 19 * blue) / 256; }
export function linearSpatialUnitV1(value: number): number { return Math.max(0, Math.min(1, value)); }
export function linearSpatialOffsetV1(width: number, height: number, x: number, y: number): number {
	return 4 * (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x)));
}

/** Direct immutable neighborhood sampling has fixed scalar scratch, no
 * encoded pixel plane, tuples or per-tap allocation. Alpha weights RGB only. */
export function linearSpatialMeanV1(source: Float32Array<ArrayBuffer>, width: number, height: number, x: number, y: number,
	bins: readonly number[], channel: -1 | 0 | 1 | 2): number {
	const radius = Math.floor(bins.length / 2); let sum = 0, weight = 0;
	for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
		const offset = linearSpatialOffsetV1(width, height, x + dx, y + dy), alpha = source[offset + 3]!;
		if (alpha === 0) continue;
		const w = alpha * bins[dx + radius]! * bins[dy + radius]!;
		const sample = channel === -1 ? linearSpatialLumaV1(encoded(source[offset]!), encoded(source[offset + 1]!), encoded(source[offset + 2]!)) : encoded(source[offset + channel]!);
		weight += w; sum += w * sample;
	}
	return sum / weight;
}

export function linearSpatialDarkV1(source: Float32Array<ArrayBuffer>, width: number, height: number, x: number, y: number): number {
	let dark = 1;
	for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
		const offset = linearSpatialOffsetV1(width, height, x + dx, y + dy), alpha = source[offset + 3]!;
		const low = Math.min(encoded(source[offset]!), encoded(source[offset + 1]!), encoded(source[offset + 2]!));
		dark = Math.min(dark, low * alpha + 1 - alpha);
	}
	return linearSpatialUnitV1(dark);
}
