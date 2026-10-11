/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionLocalRaster } from './motion-local-raster.ts';
import type { MotionEvaluatedEffect } from './motion-effect-rendering.ts';
import type { MotionVector2 } from './motion-property.ts';
import type { MotionTrackingQuad } from './motion-tracking-homography.ts';
import { motionCornerPinParameters, planMotionCornerPin } from './motion-corner-pin-plan.ts';
import { createMotionSurface, motionSurfaceLength, validateMotionSurface, type MotionSurface } from './motion-surface.ts';
import { assertMotionWorkingBudget, MOTION_DEFAULT_WORKING_BYTES } from './motion-render-budget.ts';

/** Pixel-center projective resampling stays in premultiplied linear light, with transparent outside coverage. */
export async function rasterMotionCornerPinEffect(effect: MotionEvaluatedEffect, source: MotionLocalRaster, signal?: AbortSignal): Promise<MotionLocalRaster> {
	signal?.throwIfAborted(); validateMotionSurface(source.surface);
	const plan = planMotionCornerPin(source.surface.width, source.surface.height, source.origin, motionCornerPinParameters(effect));
	assertMotionWorkingBudget((source.surface.pixels.length + motionSurfaceLength(plan.width, plan.height)) * 4 + 4096, MOTION_DEFAULT_WORKING_BYTES);
	const output = createMotionSurface(plan.width, plan.height); const origin: MotionVector2 = [source.origin[0] + plan.left, source.origin[1] + plan.top];
	const matrix = plan.inverse; const count = plan.width * plan.height;
	for (let begin = 0; begin < count; begin += 16384) {
		signal?.throwIfAborted(); const end = Math.min(count, begin + 16384);
		for (let index = begin; index < end; index++) {
			const x = index % plan.width + origin[0] + 0.5; const y = Math.floor(index / plan.width) + origin[1] + 0.5;
			if (!inside(plan.quad, x, y)) continue;
			const denominator = matrix[6] * x + matrix[7] * y + matrix[8];
			const sx = (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator - 0.5;
			const sy = (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator - 0.5;
			if (!Number.isFinite(sx) || !Number.isFinite(sy)) throw new RangeError('Motion corner-pin projection is nonfinite.');
			sample(source.surface, output, index, sx, sy);
		}
		if (end < count) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
	}
	signal?.throwIfAborted(); return { surface: output, origin };
}
function inside(quad: MotionTrackingQuad, x: number, y: number): boolean {
	let sign = 0;
	for (let index = 0; index < 4; index++) {
		const a = quad[index]!; const b = quad[(index + 1) % 4]!; const cross = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
		if (Math.abs(cross) <= 1e-8) continue; const current = Math.sign(cross);
		if (sign && sign !== current) return false; sign = current;
	}
	return true;
}
function sample(source: MotionSurface, output: MotionSurface, index: number, x: number, y: number): void {
	const ix = Math.floor(x); const iy = Math.floor(y); const fx = x - ix; const fy = y - iy;
	let red = 0; let green = 0; let blue = 0; let alpha = 0;
	for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) {
		if (ix + dx < 0 || ix + dx >= source.width || iy + dy < 0 || iy + dy >= source.height) continue;
		const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy); const at = ((iy + dy) * source.width + ix + dx) * 4;
		red += source.pixels[at]! * weight; green += source.pixels[at + 1]! * weight; blue += source.pixels[at + 2]! * weight; alpha += source.pixels[at + 3]! * weight;
	}
	alpha = Math.max(0, Math.min(1, alpha)); output.pixels[index * 4 + 3] = alpha;
	output.pixels[index * 4] = Math.max(0, Math.min(alpha, red)); output.pixels[index * 4 + 1] = Math.max(0, Math.min(alpha, green)); output.pixels[index * 4 + 2] = Math.max(0, Math.min(alpha, blue));
}
