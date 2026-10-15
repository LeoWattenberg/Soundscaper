/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ImageDefringeKernelParamsV1 {
	readonly purpleAmount: number; readonly greenAmount: number; readonly threshold: number;
}
export interface ImageDefringeKernelPixelV1 {
	red: number; green: number; blue: number;
	redChanged: boolean; greenChanged: boolean; blueChanged: boolean;
}
type Samples = Uint8Array<ArrayBuffer> | Float32Array<ArrayBuffer>;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const purple = (r: number, g: number, b: number) => Math.max(0, Math.min(r, b) - g);
const green = (r: number, g: number, b: number) => Math.max(0, g - Math.max(r, b));
const luma = (r: number, g: number, b: number) => (54 * r + 183 * g + 19 * b) / 256;

/** Metadata-only natural-byte bound. Native descriptor admission remains its
 * narrower owning policy; no plane allocation or pixel authority occurs. */
export function assertImageDefringeGeometryV1(width: number, height: number): void {
	if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 65_536)
		|| width * height > 67_108_864) throw new RangeError('Defringe exceeds its bounded source geometry.');
}

/** Immutable radius-one encoded-color evaluation. The transfer callback is
 * either byte normalization or continuous odd-sRGB; no byte working plane,
 * per-pixel allocation or feedback from previous output pixels occurs. */
export function writeImageDefringeKernelPixelV1(params: ImageDefringeKernelParamsV1, source: Samples, width: number, height: number,
	x: number, y: number, encode: (value: number) => number, target: ImageDefringeKernelPixelV1): void {
	const index = (y * width + x) * 4;
	const r = encode(source[index]!), g = encode(source[index + 1]!), b = encode(source[index + 2]!);
	target.red = r; target.green = g; target.blue = b;
	target.redChanged = false; target.greenChanged = false; target.blueChanged = false;
	if (source[index + 3] === 0) return;
	const centerY = luma(r, g, b), centerPurple = purple(r, g, b), centerGreen = green(r, g, b);
	let minimum = centerY, maximum = centerY, alphaSum = 0, purpleDifference = 0, greenDifference = 0;
	for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
		if (dx === 0 && dy === 0) continue;
		const sx = Math.max(0, Math.min(width - 1, x + dx)), sy = Math.max(0, Math.min(height - 1, y + dy));
		const from = (sy * width + sx) * 4, alpha = source[from + 3]!;
		if (alpha <= 0) continue;
		const nr = encode(source[from]!), ng = encode(source[from + 1]!), nb = encode(source[from + 2]!), neighborY = luma(nr, ng, nb);
		minimum = Math.min(minimum, neighborY); maximum = Math.max(maximum, neighborY); alphaSum += alpha;
		// Difference accumulation makes a constant region exactly neutral even
		// when its supported neighbors have arbitrary nonuniform alpha.
		purpleDifference += alpha * (centerPurple - purple(nr, ng, nb));
		greenDifference += alpha * (centerGreen - green(nr, ng, nb));
	}
	if (alphaSum === 0) return;
	const edgeGate = clamp(4 * ((maximum - minimum) - params.threshold));
	const weight = clamp(edgeGate * (params.purpleAmount * clamp(4 * purpleDifference / alphaSum)
		+ params.greenAmount * clamp(4 * greenDifference / alphaSum)));
	if (weight === 0) return;
	target.red = r + weight * (centerY - r); target.green = g + weight * (centerY - g); target.blue = b + weight * (centerY - b);
	target.redChanged = target.red !== r; target.greenChanged = target.green !== g; target.blueChanged = target.blue !== b;
}
