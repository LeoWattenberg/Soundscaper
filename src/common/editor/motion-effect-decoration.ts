/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CanvasKit } from 'canvaskit-wasm';
import { blurMotionCanvasKitSurface, filterMotionCanvasKitSurface } from './motion-canvaskit-filter.ts';
import type { MotionEffectPlan } from './motion-effect-rendering.ts';
import { clampMotionEffectChannel, motionEffectPackedColor, motionLinearLuma } from './motion-effect-pixels.ts';
import { createMotionSurface, type MotionSurface } from './motion-surface.ts';

/** Decoration remains behind the original source and may extend its coverage. */
export function renderMotionDecoration(kit: CanvasKit, source: MotionSurface, plan: MotionEffectPlan): MotionSurface {
	let decoration: MotionSurface;
	const p = plan.params;
	if (plan.type === 'outline') {
		const dilate = kit.ImageFilter.MakeDilate(p.width!, p.width!, null);
		if (!dilate) throw new Error('CanvasKit outline coverage filtering is unavailable.');
		try { decoration = filterMotionCanvasKitSurface(kit, source, { width: plan.width, height: plan.height, x: -plan.left, y: -plan.top, filter: dilate }); }
		finally { dilate.delete(); }
	} else if (plan.type === 'glow') {
		const bright = createMotionSurface(source.width, source.height);
		for (let i = 0; i < source.pixels.length; i += 4) {
			const a = source.pixels[i + 3]!; const y = a ? motionLinearLuma(source.pixels[i]! / a, source.pixels[i + 1]! / a, source.pixels[i + 2]! / a) : 0;
			const factor = p.threshold! < 1 ? clampMotionEffectChannel((y - p.threshold!) / (1 - p.threshold!)) : 0;
			for (let c = 0; c < 4; c++) bright.pixels[i + c] = source.pixels[i + c]! * factor;
		}
		decoration = blurMotionCanvasKitSurface(kit, bright, p.sigma!, { width: plan.width, height: plan.height, x: -plan.left, y: -plan.top });
	} else {
		decoration = blurMotionCanvasKitSurface(kit, source, p.sigma!, { width: plan.width, height: plan.height, x: p.offsetX! - plan.left, y: p.offsetY! - plan.top });
	}
	const output = createMotionSurface(plan.width, plan.height);
	const color = plan.type === 'glow' ? [0, 0, 0] : motionEffectPackedColor(p.color!);
	for (let y = 0; y < plan.height; y++) for (let x = 0; x < plan.width; x++) {
		const i = (y * plan.width + x) * 4; const sx = x + plan.left; const sy = y + plan.top;
		const si = sx >= 0 && sx < source.width && sy >= 0 && sy < source.height ? (sy * source.width + sx) * 4 : -1;
		const a = si >= 0 ? source.pixels[si + 3]! : 0;
		const coverage = plan.type === 'outline' ? Math.max(0, decoration.pixels[i + 3]! - a) : decoration.pixels[i + 3]!;
		const weight = plan.type === 'glow' ? p.intensity! : p.opacity!;
		const behind = coverage * weight * (1 - a); const alpha = a + behind;
		for (let c = 0; c < 3; c++) {
			const original = si >= 0 ? source.pixels[si + c]! : 0;
			output.pixels[i + c] = plan.type === 'glow' ? Math.min(alpha, original + decoration.pixels[i + c]! * weight) : original + color[c]! * behind;
		}
		output.pixels[i + 3] = alpha;
	}
	return output;
}
