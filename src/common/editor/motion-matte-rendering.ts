/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionLayerBase } from './motion-composition.ts';
import { motionLinearLuma } from './motion-effect-pixels.ts';
import { createMotionSurface, validateMotionSurface, type MotionSurface } from './motion-surface.ts';

/** Luma includes alpha in the linear Rec.709 working space; inversion follows matte opacity. */
export function applyMotionMatte(source: MotionSurface, matte: MotionSurface | null, mode: NonNullable<MotionLayerBase['matte']>['mode'], opacity: number = 1): MotionSurface {
	validateMotionSurface(source);
	if (!Number.isFinite(opacity)) throw new RangeError('Motion matte source opacity must be finite.');
	if (matte) {
		validateMotionSurface(matte);
		if (source.width !== matte.width || source.height !== matte.height) throw new RangeError('Motion matte must use the containing composition pixel grid.');
	}
	const inverted = mode === 'alpha-inverted' || mode === 'luma-inverted';
	const luma = mode === 'luma' || mode === 'luma-inverted';
	const weight = Math.max(0, Math.min(1, opacity));
	const output = createMotionSurface(source.width, source.height);
	for (let i = 0; i < source.pixels.length; i += 4) {
		const coverage = matte ? weight * (luma ? motionLinearLuma(matte.pixels[i]!, matte.pixels[i + 1]!, matte.pixels[i + 2]!) : matte.pixels[i + 3]!) : 0;
		const factor = Math.max(0, Math.min(1, inverted ? 1 - coverage : coverage));
		for (let c = 0; c < 4; c++) output.pixels[i + c] = source.pixels[i + c]! * factor;
	}
	return output;
}
