/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionCompositionFrame, MotionEvaluatedLayer } from './motion-composition-evaluation.ts';
import type { MotionRasterizer } from './motion-composition-renderer.ts';
import { applyMotionEffects, type MotionEffectRasterizer } from './motion-effect-rendering.ts';
import { applyMotionMasks, type MotionMaskRasterizer } from './motion-mask-rendering.ts';
import { motionSourceWorldMatrix } from './motion-local-raster.ts';
import { createMotionSurface, motionBlendChannel, transformMotionSurface, validateMotionSurface, type MotionSurface } from './motion-surface.ts';
import { applyMotionMatte } from './motion-matte-rendering.ts';

/** An adjustment operates on the complete visible backdrop below it; isolate subsets in a precomposition. */
export function motionAdjustmentApplies(layer: MotionEvaluatedLayer, frame: MotionCompositionFrame): boolean {
	if (layer.state.kind !== 'adjustment') throw new TypeError('Expected a motion adjustment layer.');
	const hiddenMattes = new Set(frame.layers.flatMap((item) => item.state.matte ? [item.state.matte.layerId] : []));
	const pixelLayers = frame.layers.filter((item) => !hiddenMattes.has(item.state.id) && !['null', 'camera', 'light', 'adjustment'].includes(item.state.kind));
	const selected = new Set(layer.state.targetLayerIds);
	const active = pixelLayers.filter((item) => selected.has(item.state.id));
	if (!active.length || !layer.state.effects.some((effect) => effect.enabled)) return false;
	const index = frame.layers.indexOf(layer);
	if (active.some((item) => frame.layers.indexOf(item) <= index)) throw new Error(`Adjustment ${layer.state.name} targets must be below it in the composition.`);
	if (pixelLayers.some((item) => frame.layers.indexOf(item) > index && !selected.has(item.state.id))) {
		throw new Error(`Adjustment ${layer.state.name} must target every visible pixel layer below it. Precompose selected targets to isolate a partial group.`);
	}
	return true;
}

/** Masks, transform, matte and opacity weight replacement, preserving the unadjusted backdrop outside coverage. */
export async function renderMotionAdjustment(layer: MotionEvaluatedLayer, backdrop: MotionSurface, options: Readonly<{
	rasterizer: MotionRasterizer; signal?: AbortSignal; matte?: MotionSurface | null; matteOpacity?: number;
}>): Promise<MotionSurface> {
	options.signal?.throwIfAborted(); validateMotionSurface(backdrop);
	let coverage = { surface: createMotionSurface(backdrop.width, backdrop.height, [1, 1, 1, 1]), origin: [0, 0] as readonly [number, number] };
	if (layer.state.masks.length) coverage = await applyMotionMasks(coverage, layer.state.masks, options.rasterizer as MotionMaskRasterizer, options.signal);
	let weight = transformMotionSurface(coverage.surface, backdrop.width, backdrop.height, motionSourceWorldMatrix(layer.worldMatrix, coverage.origin));
	if (layer.state.matte) weight = applyMotionMatte(weight, options.matte ?? null, layer.state.matte.mode, options.matteOpacity);
	const filtered = await applyMotionEffects({ surface: backdrop, origin: [0, 0] }, layer.state.effects, options.rasterizer as MotionEffectRasterizer, options.signal);
	const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
	const effected = transformMotionSurface(filtered.surface, backdrop.width, backdrop.height, motionSourceWorldMatrix(identity, filtered.origin));
	const output = createMotionSurface(backdrop.width, backdrop.height);
	const opacity = Math.max(0, Math.min(1, layer.state.transform.opacity));
	for (let i = 0; i < output.pixels.length; i += 4) {
		const amount = weight.pixels[i + 3]! * opacity;
		const ab = backdrop.pixels[i + 3]!; const af = effected.pixels[i + 3]!;
		for (let c = 0; c < 3; c++) {
			const blended = motionBlendChannel(ab ? backdrop.pixels[i + c]! / ab : 0, af ? effected.pixels[i + c]! / af : 0, layer.state.blendMode) * af;
			output.pixels[i + c] = (1 - amount) * backdrop.pixels[i + c]! + amount * blended;
		}
		output.pixels[i + 3] = (1 - amount) * ab + amount * af;
	}
	options.signal?.throwIfAborted(); validateMotionSurface(output); return output;
}
