/* SPDX-License-Identifier: AGPL-3.0-only */

export interface LinearCubeLutSamplingTableCurrentV1 {
	readonly size: number;
	readonly domainMin: readonly [number, number, number];
	readonly domainMax: readonly [number, number, number];
	readonly values: ArrayLike<number>;
}
/** Conservative parser/transient reserve, not an exact JavaScript heap bound. */
export const LINEAR_LUT_TRANSIENT_RESERVE_BYTES_V1 = 128 * 1024 * 1024;

function axis(value: number, minimum: number, maximum: number, size: number): number { return Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum))) * (size - 1); }
function mix(a: number, b: number, amount: number): number { return a + (b - a) * amount; }

/** Admitted native numbers only; this scalar grants no resource authority.
 * Red varies fastest. Preserve the existing B→G→R difference-form interpolation
 * and input-domain clamp without allocating per-pixel axis objects or arrays. */
export function sampleLinearCubeLutChannelCurrentV1(lut: Readonly<LinearCubeLutSamplingTableCurrentV1>, red: number, green: number, blue: number, channel: number): number {
	const size = lut.size, values = lut.values;
	const r = axis(red, lut.domainMin[0], lut.domainMax[0], size), g = axis(green, lut.domainMin[1], lut.domainMax[1], size), b = axis(blue, lut.domainMin[2], lut.domainMax[2], size);
	const r0 = Math.floor(r), g0 = Math.floor(g), b0 = Math.floor(b), r1 = Math.min(size - 1, r0 + 1), g1 = Math.min(size - 1, g0 + 1), b1 = Math.min(size - 1, b0 + 1);
	const stride = size * size;
	const z00 = mix(values[(b0 * stride + g0 * size + r0) * 3 + channel]!, values[(b1 * stride + g0 * size + r0) * 3 + channel]!, b - b0);
	const z01 = mix(values[(b0 * stride + g1 * size + r0) * 3 + channel]!, values[(b1 * stride + g1 * size + r0) * 3 + channel]!, b - b0);
	const z10 = mix(values[(b0 * stride + g0 * size + r1) * 3 + channel]!, values[(b1 * stride + g0 * size + r1) * 3 + channel]!, b - b0);
	const z11 = mix(values[(b0 * stride + g1 * size + r1) * 3 + channel]!, values[(b1 * stride + g1 * size + r1) * 3 + channel]!, b - b0);
	return mix(mix(z00, z01, g - g0), mix(z10, z11, g - g0), r - r0);
}
