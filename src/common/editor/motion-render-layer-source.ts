/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionCompositionFrame, MotionEvaluatedLayer } from './motion-composition-evaluation.ts';
import type { MotionRasterizer } from './motion-composition-renderer.ts';
import { applyMotionMasks, type MotionMaskRasterizer } from './motion-mask-rendering.ts';
import { applyMotionEffects, type MotionEffectRasterizer } from './motion-effect-rendering.ts';
import { motionSourceWorldMatrix, type MotionLocalRaster } from './motion-local-raster.ts';
import { createMotionSurface, transformMotionSurface, validateMotionSurface, type MotionSurface } from './motion-surface.ts';

/** Source -> masks -> effects -> world transform; the caller owns matte, opacity and composite. */
export async function renderMotionLayerSource(layer: MotionEvaluatedLayer, current: MotionCompositionFrame, options: Readonly<{
	rasterizer: MotionRasterizer; signal?: AbortSignal; renderPrecomposition: (frame: MotionCompositionFrame) => Promise<MotionSurface>;
}>): Promise<MotionSurface> {
	options.signal?.throwIfAborted();
	let source: MotionSurface;
	if ((layer.state.masks.length || layer.state.effects.some((effect) => effect.enabled)) && layer.sourceAvailable) {
		const local = await renderMotionLayerLocalSource(layer, current, options);
		source = transformMotionSurface(local.surface, current.width, current.height, motionSourceWorldMatrix(layer.worldMatrix, local.origin));
	} else if (layer.precomposition !== null) source = transformMotionSurface(await options.renderPrecomposition(layer.precomposition), current.width, current.height, layer.worldMatrix);
	else if (!layer.sourceAvailable) source = createMotionSurface(current.width, current.height);
	else source = await options.rasterizer.rasterize(layer, current, options.signal);
	options.signal?.throwIfAborted(); validateMotionSurface(source); return source;
}

/** Local pixels remain independent of projection; precompositions render into isolated child grids. */
export async function renderMotionLayerLocalSource(layer: MotionEvaluatedLayer, current: MotionCompositionFrame, options: Readonly<{
	rasterizer: MotionRasterizer; signal?: AbortSignal; renderPrecomposition: (frame: MotionCompositionFrame) => Promise<MotionSurface>;
}>): Promise<MotionLocalRaster> {
	options.signal?.throwIfAborted();
	if (!layer.sourceAvailable) {
		if (layer.precomposition) await options.renderPrecomposition(layer.precomposition);
		return { surface: createMotionSurface(1, 1), origin: [0, 0] };
	}
	let local = layer.precomposition !== null ? { surface: await options.renderPrecomposition(layer.precomposition), origin: [0, 0] as const }
		: await options.rasterizer.rasterizeSource!(layer, current, options.signal);
	if (layer.state.masks.length) local = await applyMotionMasks(local, layer.state.masks, options.rasterizer as MotionMaskRasterizer, options.signal);
	if (layer.state.effects.some((effect) => effect.enabled)) local = await applyMotionEffects(local, layer.state.effects, options.rasterizer as MotionEffectRasterizer, options.signal);
	options.signal?.throwIfAborted(); validateMotionSurface(local.surface); return local;
}
