/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ImageChromaticAberrationPlanV1 {
	readonly width: number; readonly height: number;
	readonly red: number; readonly blue: number;
	readonly redCoefficient: number; readonly blueCoefficient: number;
	readonly neutral: boolean;
}

export interface ImageChromaticAberrationTapsV1 {
	x: number; y: number;
	stepX: 1 | -1; stepY: 1 | -1;
	fractionX: number; fractionY: number;
}

/** Independent output→source R/B radial maps; Green and reference alpha stay
 * on the original grid. The exact coefficient is control*0.0001, with radius
 * normalized by the half diagonal. No pixel access or allocation occurs. */
export function planImageChromaticAberrationV1(redValue: unknown, blueValue: unknown, width: number, height: number): Readonly<ImageChromaticAberrationPlanV1> {
	const red = control(redValue), blue = control(blueValue);
	if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 65_536)
		|| width * height > 67_108_864) throw new RangeError('Chromatic aberration exceeds its bounded source geometry.');
	return Object.freeze({ width, height, red, blue, redCoefficient: red * .0001, blueCoefficient: blue * .0001, neutral: red === 0 && blue === 0 });
}

/** Pixel-edge coordinates; callers supply centers. Finite outside coordinates
 * remain available for independently zero-extended transparent filter taps. */
export function writeImageChromaticAberrationPointV1(plan: ImageChromaticAberrationPlanV1, channel: 'red' | 'blue', x: number, y: number,
	point: { x: number; y: number }): boolean {
	if (channel !== 'red' && channel !== 'blue') throw new RangeError('Chromatic aberration maps only red or blue.');
	if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
	const cx = plan.width / 2, cy = plan.height / 2, dx = x - cx, dy = y - cy;
	const radiusSquared = (dx * dx + dy * dy) / (cx * cx + cy * cy);
	const scale = 1 + (channel === 'red' ? plan.redCoefficient : plan.blueCoefficient) * radiusSquared;
	point.x = cx + dx * scale; point.y = cy + dy * scale;
	return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** Integer destination indices with signed, directly retained displacement
 * fractions. Adding a tiny shift to an absolute coordinate can erase its
 * supported neighbor, whose alpha must remain available for reconstruction.
 * Reuse one caller-owned tap record; no per-pixel allocation is needed. */
export function writeImageChromaticAberrationTapsV1(plan: ImageChromaticAberrationPlanV1, channel: 'red' | 'blue', x: number, y: number,
	taps: ImageChromaticAberrationTapsV1): boolean {
	if (channel !== 'red' && channel !== 'blue') throw new RangeError('Chromatic aberration maps only red or blue.');
	if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return false;
	const cx = plan.width / 2, cy = plan.height / 2, dx = x + .5 - cx, dy = y + .5 - cy;
	const radiusSquared = (dx * dx + dy * dy) / (cx * cx + cy * cy);
	const radial = (channel === 'red' ? plan.redCoefficient : plan.blueCoefficient) * radiusSquared;
	const shiftX = dx * radial, shiftY = dy * radial;
	if (!Number.isFinite(shiftX) || !Number.isFinite(shiftY)) return false;
	const magnitudeX = Math.abs(shiftX), magnitudeY = Math.abs(shiftY), wholeX = Math.floor(magnitudeX), wholeY = Math.floor(magnitudeY);
	taps.stepX = shiftX < 0 ? -1 : 1; taps.stepY = shiftY < 0 ? -1 : 1;
	taps.x = x + taps.stepX * wholeX; taps.y = y + taps.stepY * wholeY;
	taps.fractionX = magnitudeX - wholeX; taps.fractionY = magnitudeY - wholeY;
	return true;
}

function control(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < -100 || value > 100) {
		throw new RangeError('Chromatic aberration controls require finite values between -100 and 100.');
	}
	return value === 0 ? 0 : value;
}
