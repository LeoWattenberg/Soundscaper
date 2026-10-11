/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionSurface } from './motion-surface.ts';
import { motionLinearLuma } from './motion-effect-pixels.ts';
import type { MotionLayerBase } from './motion-composition.ts';

export interface MotionPlaneMatte { readonly surface: MotionSurface | null; readonly opacity: number; readonly mode: NonNullable<MotionLayerBase['matte']>['mode'] }
/** Sample premultiplied pixel centers, treating every outside tap as transparent. */
export function sampleMotionPlaneSurface(source: MotionSurface, sx: number, sy: number, output: Float64Array, slot = 0): void {
	output.fill(0, slot, slot + 4);
	const ix = Math.floor(sx); const iy = Math.floor(sy); const fx = sx - ix; const fy = sy - iy;
	for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
		if (ix + dx < 0 || ix + dx >= source.width || iy + dy < 0 || iy + dy >= source.height) continue;
		const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy); const i = ((iy + dy) * source.width + ix + dx) * 4;
		for (let c = 0; c < 4; c++) output[slot + c]! += source.pixels[i + c]! * weight;
	}
	const alpha = Math.min(1, Math.max(0, output[slot + 3]!)); output[slot + 3] = alpha;
	for (let c = 0; c < 3; c++) output[slot + c] = Math.min(alpha, Math.max(0, output[slot + c]!));
}
export function motionPlaneMatteWeight(matte: MotionPlaneMatte, r: number, g: number, b: number, alpha: number): number {
	const coverage = Math.max(0, Math.min(1, matte.opacity)) * (matte.mode.startsWith('luma') ? motionLinearLuma(r, g, b) : alpha);
	return Math.max(0, Math.min(1, matte.mode.endsWith('inverted') ? 1 - coverage : coverage));
}
