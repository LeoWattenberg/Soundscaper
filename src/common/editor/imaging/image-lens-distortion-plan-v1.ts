/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ImageLensDistortionPlanV1 {
	readonly width: number;
	readonly height: number;
	readonly amount: number;
	readonly coefficient: number;
	readonly neutral: boolean;
}

/** Same-extent inverse radial sampling. The half diagonal normalizes radius,
 * so r²≤1 throughout the output aperture and dr_source/dr_output≥0.1.
 * Coordinates describe pixel edges; renderers pass centers (x+0.5,y+0.5).
 * Outside source taps are transparent, never replicated border pixels. */
export function planImageLensDistortionV1(amountValue: unknown, width: number, height: number): Readonly<ImageLensDistortionPlanV1> {
	if (typeof amountValue !== 'number' || !Number.isFinite(amountValue) || amountValue < -100 || amountValue > 100) {
		throw new RangeError('Lens distortion amount must be finite and between -100 and 100.');
	}
	if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 65_536)
		|| width * height > 67_108_864) throw new RangeError('Lens distortion exceeds its bounded source geometry.');
	const amount = amountValue === 0 ? 0 : amountValue;
	return Object.freeze({ width, height, amount, coefficient: amount * .003, neutral: amount === 0 });
}

/** Allocation-free output→source mapping. Finite outside coordinates are kept
 * so each bilinear tap can independently contribute transparent support. */
export function writeImageLensDistortionPointV1(plan: ImageLensDistortionPlanV1, x: number, y: number,
	point: { x: number; y: number }): boolean {
	if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
	const cx = plan.width / 2, cy = plan.height / 2, dx = x - cx, dy = y - cy;
	const radiusSquared = (dx * dx + dy * dy) / (cx * cx + cy * cy);
	const scale = 1 + plan.coefficient * radiusSquared;
	point.x = cx + dx * scale; point.y = cy + dy * scale;
	return Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function mapImageLensDistortionPointV1(plan: ImageLensDistortionPlanV1, x: number, y: number): Readonly<{ x: number; y: number }> | null {
	const point = { x: 0, y: 0 };
	return writeImageLensDistortionPointV1(plan, x, y, point) ? Object.freeze(point) : null;
}
