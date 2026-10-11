/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionEffect } from './motion-composition.ts';
import type { MotionLocalRaster } from './motion-local-raster.ts';
import type { EvaluatedMotionState } from './motion-property-evaluation.ts';
import { motionSurfaceLength, validateMotionSurface } from './motion-surface.ts';
import { validateVideoEffectParams, videoEffectDefaults, VIDEO_EFFECT_TYPES } from './video-effects.js';
import { motionCornerPinParameters, planMotionCornerPin } from './motion-corner-pin-plan.ts';
import type { MotionVector2 } from './motion-property.ts';

export type MotionEvaluatedEffect = EvaluatedMotionState<MotionEffect>;
export const MOTION_EFFECT_TYPES: readonly string[] = Object.freeze([...VIDEO_EFFECT_TYPES, 'corner-pin']);
export interface MotionEffectRasterizer {
	/** Peak includes the original source, current effect input/output, native scratch and readback. */
	readonly supportedEffectTypes?: readonly string[];
	estimateEffectWorkingBytes(width: number, height: number, effects: readonly MotionEvaluatedEffect[], origin?: MotionVector2): number;
	rasterizeEffect(effect: MotionEvaluatedEffect, source: MotionLocalRaster, signal?: AbortSignal): Promise<MotionLocalRaster>;
}
export interface MotionEffectPlan {
	readonly type: string; readonly params: Readonly<Record<string, number>>;
	readonly left: number; readonly top: number; readonly width: number; readonly height: number;
}

export function motionEffectIsNoop(type: string, p: Readonly<Record<string, number>>): boolean {
	return type === 'gaussian-blur' && p.sigma === 0 || type === 'outline' && (p.width === 0 || p.opacity === 0)
		|| type === 'drop-shadow' && p.opacity === 0 || type === 'glow' && (p.intensity === 0 || p.threshold === 1)
		|| type === 'vignette' && p.amount === 0 || type === 'sharpen' && p.amount === 0
		|| type === 'rgb-split' && p.offsetX === 0 && p.offsetY === 0 || type === 'spill-suppression' && p.strength === 0;
}

/** Registry authority is reused; effect pixels use Motionscaper's linear SDR/coverage contract. */
export function motionEffectParameters(effect: MotionEvaluatedEffect): Readonly<Record<string, number>> {
	if (effect.type === 'corner-pin') return motionCornerPinParameters(effect);
	if (!VIDEO_EFFECT_TYPES.includes(effect.type)) throw new Error(`Unsupported motion effect ${effect.type}; its renderer is unavailable.`);
	const supplied = Object.fromEntries(effect.parameters.map((parameter) => {
		if (typeof parameter.value !== 'number') throw new TypeError(`Motion effect ${effect.id}.${parameter.id} requires a scalar parameter.`);
		return [parameter.id, parameter.value];
	})) as Record<string, number>;
	validateVideoEffectParams(effect.type, supplied, `Motion effect ${effect.id}`);
	return Object.freeze({ ...videoEffectDefaults(effect.type) as Record<string, number>, ...supplied });
}

/** Filters include their declared five-sigma support; these bounds remain in source-local pixels. */
export function planMotionEffect(effect: MotionEvaluatedEffect, width: number, height: number, origin: MotionVector2 = [0, 0]): MotionEffectPlan {
	motionSurfaceLength(width, height); const params = motionEffectParameters(effect);
	if (effect.type === 'corner-pin') return planMotionCornerPin(width, height, origin, params);
	let left = 0; let top = 0; let right = width; let bottom = height;
	if (motionEffectIsNoop(effect.type, params)) { /* No decoration extends the local bounds. */ }
	else if (effect.type === 'gaussian-blur' || effect.type === 'glow') {
		const pad = Math.ceil(5 * params.sigma!);
		left -= pad; top -= pad; right += pad; bottom += pad;
	} else if (effect.type === 'outline') {
		left -= params.width!; top -= params.width!; right += params.width!; bottom += params.width!;
	} else if (effect.type === 'drop-shadow') {
		const pad = Math.ceil(5 * params.sigma!);
		left = Math.min(0, params.offsetX! - pad); top = Math.min(0, params.offsetY! - pad);
		right = Math.max(width, width + params.offsetX! + pad); bottom = Math.max(height, height + params.offsetY! + pad);
	} else if (effect.type === 'rgb-split') {
		left -= Math.abs(params.offsetX!); top -= Math.abs(params.offsetY!); right += Math.abs(params.offsetX!); bottom += Math.abs(params.offsetY!);
	}
	const plan = { type: effect.type, params, left, top, width: right - left, height: bottom - top };
	motionSurfaceLength(plan.width, plan.height); return Object.freeze(plan);
}

export function estimateMotionEffectWorkingBytes(width: number, height: number, effects: readonly MotionEvaluatedEffect[], origin: MotionVector2 = [0, 0]): number {
	const original = motionSurfaceLength(width, height) * Float32Array.BYTES_PER_ELEMENT;
	let peak = original;
	for (const effect of effects) {
		if (!effect.enabled) continue;
		const plan = planMotionEffect(effect, width, height, origin);
		const multiplier = ['gaussian-blur', 'glow', 'outline', 'drop-shadow', 'sharpen'].includes(plan.type) ? 128 : 32;
		peak = Math.max(peak, original + Math.max(plan.width * plan.height * multiplier, (width * height + plan.width * plan.height) * 16 + 4096));
		width = plan.width; height = plan.height; origin = [origin[0] + plan.left, origin[1] + plan.top];
	}
	return peak;
}

/** Exactly one effect executes at a time. No renderer may mutate a retained/borrowed source. */
export async function applyMotionEffects(source: MotionLocalRaster, effects: readonly MotionEvaluatedEffect[], rasterizer: MotionEffectRasterizer, signal?: AbortSignal): Promise<MotionLocalRaster> {
	let current = source;
	for (const effect of effects) {
		if (!effect.enabled) continue;
		signal?.throwIfAborted(); validateMotionSurface(current.surface);
		const plan = planMotionEffect(effect, current.surface.width, current.surface.height, current.origin);
		const next = await rasterizer.rasterizeEffect(effect, current, signal);
		signal?.throwIfAborted(); validateMotionSurface(next.surface);
		if (next.surface.width !== plan.width || next.surface.height !== plan.height || next.origin[0] !== current.origin[0] + plan.left || next.origin[1] !== current.origin[1] + plan.top) {
			throw new Error(`Motion effect ${effect.id} changed its admitted local bounds.`);
		}
		current = next;
		await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
	}
	signal?.throwIfAborted(); return current;
}
