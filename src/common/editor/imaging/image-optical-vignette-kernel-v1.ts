/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ImageOpticalVignetteKernelV1 {
	readonly amount: number; readonly width: number; readonly height: number;
	readonly exponentScale: number; readonly neutral: boolean;
}

/** Metadata only: a same-extent incoming-grid radial light gain. The natural
 * byte geometry bound is independent of the native descriptor's tighter
 * owning profile. No source samples or frame-sized scratch are involved. */
export function prepareImageOpticalVignetteKernelV1(amountValue: unknown, width: number, height: number): Readonly<ImageOpticalVignetteKernelV1> {
	if (typeof amountValue !== 'number' || !Number.isFinite(amountValue) || amountValue < -100 || amountValue > 100) {
		throw new RangeError('Optical vignette requires a finite amount between -100 and 100.');
	}
	if (![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 65_536)
		|| width * height > 67_108_864) throw new RangeError('Optical vignette exceeds its bounded source geometry.');
	const amount = amountValue === 0 ? 0 : amountValue;
	return Object.freeze({ amount, width, height, exponentScale: 2 * amount / 100, neutral: amount === 0 });
}

/** Integer pixel centers, normalized by the half diagonal. Positive amounts
 * lift corners, negative amounts attenuate them; gain is always positive.
 * Callers retain exact samples whenever gain rounds to1. */
export function imageOpticalVignetteGainV1(plan: ImageOpticalVignetteKernelV1, x: number, y: number): number {
	if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) || x < 0 || x >= plan.width || y < 0 || y >= plan.height) {
		throw new RangeError('Optical vignette requires an admitted pixel coordinate.');
	}
	const dx = 2 * x + 1 - plan.width, dy = 2 * y + 1 - plan.height;
	const radiusSquared = (dx * dx + dy * dy) / (plan.width * plan.width + plan.height * plan.height);
	return 2 ** (plan.exponentScale * radiusSquared);
}
