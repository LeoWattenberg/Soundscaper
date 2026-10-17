/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CanvasKit } from 'canvaskit-wasm';
import { blurMotionCanvasKitSurface } from './motion-canvaskit-filter.ts';
import { renderMotionDecoration } from './motion-effect-decoration.ts';
import { estimateMotionEffectWorkingBytes, motionEffectIsNoop, planMotionEffect, type MotionEvaluatedEffect } from './motion-effect-rendering.ts';
import { renderMotionPixelate, renderMotionPointwiseEffect, renderMotionRgbSplit } from './motion-effect-pixels.ts';
import type { MotionLocalRaster } from './motion-local-raster.ts';
import { assertMotionWorkingBudget, MOTION_DEFAULT_WORKING_BYTES } from './motion-render-budget.ts';
import { createMotionSurface, validateMotionSurface, type MotionSurface } from './motion-surface.ts';

/** The same pinned native float filters serve CPU and GPU-composited Motion frames. */
export function rasterMotionCanvasKitEffect(kit: CanvasKit, effect: MotionEvaluatedEffect, source: MotionLocalRaster, signal?: AbortSignal): MotionLocalRaster {
	signal?.throwIfAborted(); validateMotionSurface(source.surface);
	if (effect.type === 'corner-pin') throw new Error('Motion corner-pin requires its projective rasterizer.');
	const plan = planMotionEffect(effect, source.surface.width, source.surface.height, source.origin);
	if (motionEffectIsNoop(plan.type, plan.params)) return source;
	assertMotionWorkingBudget(estimateMotionEffectWorkingBytes(source.surface.width, source.surface.height, [effect], source.origin), MOTION_DEFAULT_WORKING_BYTES);
	let output: MotionSurface;
	if (plan.type === 'gaussian-blur') output = blurMotionCanvasKitSurface(kit, source.surface, plan.params.sigma!, { width: plan.width, height: plan.height, x: -plan.left, y: -plan.top });
	else if (['glow', 'outline', 'drop-shadow'].includes(plan.type)) output = renderMotionDecoration(kit, source.surface, plan);
	else {
		output = createMotionSurface(plan.width, plan.height);
		if (plan.type === 'pixelate') renderMotionPixelate(source.surface, output, plan.params.blockSize!);
		else if (plan.type === 'rgb-split') renderMotionRgbSplit(source.surface, output, plan);
		else {
			const average = plan.type === 'sharpen' ? blurMotionCanvasKitSurface(kit, source.surface, 1, { width: plan.width, height: plan.height, x: 0, y: 0 }) : undefined;
			renderMotionPointwiseEffect(source.surface, output, plan, average);
		}
	}
	signal?.throwIfAborted();
	return { surface: output, origin: [source.origin[0] + plan.left, source.origin[1] + plan.top] };
}
