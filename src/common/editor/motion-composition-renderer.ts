/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertMotionFrameConsumed, type MotionCompositionFrame, type MotionEvaluatedLayer } from './motion-composition-evaluation.ts';
import { assertMotion2DMatrix, compositeMotionSurfaces, createMotionSurface, type MotionBlendMode, type MotionSurface } from './motion-surface.ts';
import type { MotionColor } from './motion-property.ts';
import { assertMotionWorkingBudget, estimateMotionFrameWorkingBytes, MOTION_DEFAULT_WORKING_BYTES } from './motion-render-budget.ts';
import type { MotionLocalRaster } from './motion-local-raster.ts';
import { assertMotionMaskParameters, type MotionMaskRasterizer } from './motion-mask-rendering.ts';
import { motionEffectParameters, type MotionEffectRasterizer } from './motion-effect-rendering.ts';
import { assertMotionAcyclic } from './motion-project-graph.ts';
import { applyMotionMatte } from './motion-matte-rendering.ts';
import { renderMotionLayerSource } from './motion-render-layer-source.ts';

export interface MotionRasterizer extends Partial<MotionMaskRasterizer>, Partial<MotionEffectRasterizer> {
	/** Peak scratch plus returned pixels; the default assumes two composition-sized float surfaces. */
	estimateWorkingBytes?(layer: MotionEvaluatedLayer, target: MotionCompositionFrame): number;
	/** Rasterize source plus its world transform into the target composition's pixel grid. */
	rasterize(layer: MotionEvaluatedLayer, target: MotionCompositionFrame, signal?: AbortSignal): Promise<MotionSurface>;
	/** Peak source rasterization, masks AND local effects, including returned pixels, before transform. */
	estimateSourceWorkingBytes?(layer: MotionEvaluatedLayer, target: MotionCompositionFrame): number;
	rasterizeSource?(layer: MotionEvaluatedLayer, target: MotionCompositionFrame, signal?: AbortSignal): Promise<MotionLocalRaster>;
}
export interface MotionCompositeTarget {
	composite(source: MotionSurface, mode: MotionBlendMode, opacity: number): void;
	finish(): MotionSurface;
	dispose(): void;
}
export interface MotionCompositor { readonly retainedSurfaceCount?: 1 | 3; begin(width: number, height: number, background: MotionColor): MotionCompositeTarget }
export interface MotionRenderResult extends MotionSurface { readonly consumedOperationIds: readonly string[] }

export const motionCpuCompositor: MotionCompositor = Object.freeze({ retainedSurfaceCount: 1, begin(width: number, height: number, background: MotionColor): MotionCompositeTarget {
	let surface: MotionSurface | null = createMotionSurface(width, height, background);
	return { composite(source, mode, opacity) { if (!surface) throw new Error('Motion composition target is disposed.'); compositeMotionSurfaces(surface, source, mode, opacity); },
		finish() { if (!surface) throw new Error('Motion composition target is disposed.'); return surface; }, dispose() { surface = null; } };
} });

/** Identical evaluated input and rasterizer serve seeking, preview, thumbnails, delivery and linked sources. */
export async function renderMotionCompositionFrame(frame: MotionCompositionFrame, options: Readonly<{
	rasterizer: MotionRasterizer; compositor?: MotionCompositor; signal?: AbortSignal; maximumWorkingBytes?: number;
}>): Promise<MotionRenderResult> {
	options.signal?.throwIfAborted();
	admitFrame(frame, options.rasterizer);
	assertMotionWorkingBudget(estimateMotionFrameWorkingBytes(frame, options.rasterizer, options.compositor ?? motionCpuCompositor), options.maximumWorkingBytes ?? MOTION_DEFAULT_WORKING_BYTES);
	const consumed: string[] = [];
	const render = async (current: MotionCompositionFrame): Promise<MotionSurface> => {
		options.signal?.throwIfAborted();
		const target = (options.compositor ?? motionCpuCompositor).begin(current.width, current.height, current.background);
		const layers = new Map(current.layers.map((layer) => [layer.state.id, layer]));
		const matteIds = new Set(current.layers.flatMap((layer) => layer.state.matte ? [layer.state.matte.layerId] : []));
		const matteCache = new Map<string, MotionSurface>();
		const processed = new Set<string>();
		consumed.push(current.requiredOperationIds[0]!);
		const sourceFor = async (layer: MotionEvaluatedLayer): Promise<MotionSurface> => {
			const cached = matteCache.get(layer.state.id); if (cached) return cached;
			let source = await renderMotionLayerSource(layer, current, { ...options, renderPrecomposition: render });
			if (layer.state.matte) {
				const matte = layers.get(layer.state.matte.layerId);
				source = applyMotionMatte(source, matte ? await sourceFor(matte) : null, layer.state.matte.mode, matte?.state.transform.opacity);
			}
			if (matteIds.has(layer.state.id)) matteCache.set(layer.state.id, source);
			if (!processed.has(layer.state.id)) { processed.add(layer.state.id); consumed.push(...layer.operations.map((operation) => operation.id)); }
			return source;
		};
		try {
			for (const layer of [...current.layers].reverse()) {
				options.signal?.throwIfAborted();
				if (layer.state.kind === 'null') { consumed.push(...layer.operations.map((operation) => operation.id)); continue; }
				const source = await sourceFor(layer);
				if (!matteIds.has(layer.state.id)) target.composite(source, layer.state.blendMode, layer.state.transform.opacity);
			}
			return target.finish();
		} finally { matteCache.clear(); target.dispose(); }
	};
	const surface = await render(frame);
	options.signal?.throwIfAborted();
	assertMotionFrameConsumed(frame, consumed);
	return Object.freeze({ ...surface, consumedOperationIds: Object.freeze(consumed) });
}

function admitFrame(frame: MotionCompositionFrame, rasterizer: MotionRasterizer): void {
	const layers = new Map(frame.layers.map((layer) => [layer.state.id, layer]));
	assertMotionAcyclic(new Map(frame.layers.map((layer) => [layer.state.id, layer.state.matte ? [layer.state.matte.layerId] : []])), 'matte', 128);
	for (const layer of frame.layers) {
		if (layer.state.is3D) throw new Error(`Unsupported 3D motion layer ${layer.state.name}.`);
		assertMotion2DMatrix(layer.worldMatrix);
		for (const operation of layer.operations) {
			if (['camera', 'light', 'shape-operator', 'text-animator'].includes(operation.kind)) throw new Error(`Unsupported motion ${operation.kind} ${operation.sourceId}; its renderer is unavailable.`);
			if (operation.kind === 'effect' && (!rasterizer.rasterizeSource || !rasterizer.estimateSourceWorkingBytes || !rasterizer.rasterizeEffect || !rasterizer.estimateEffectWorkingBytes)) {
				throw new Error(`Unsupported motion effect ${operation.sourceId}; its local-source renderer is unavailable.`);
			}
			if (operation.kind === 'mask' && (!rasterizer.rasterizeSource || !rasterizer.estimateSourceWorkingBytes || !rasterizer.rasterizeMask || !rasterizer.estimateMaskWorkingBytes)) {
				throw new Error(`Unsupported motion mask ${operation.sourceId}; its local-source renderer is unavailable.`);
			}
		}
		if (layer.state.kind !== 'null') for (const mask of layer.state.masks) assertMotionMaskParameters(mask);
		if (layer.state.kind !== 'null') for (const effect of layer.state.effects) if (effect.enabled) motionEffectParameters(effect);
		const matteSource = layer.state.matte ? layers.get(layer.state.matte.layerId) : null;
		if (matteSource && ['null', 'camera', 'light', 'adjustment'].includes(matteSource.state.kind)) throw new Error(`Motion matte source ${matteSource.state.name} is a non-pixel layer.`);
		if (layer.state.kind === 'adjustment') throw new Error(`Unsupported motion adjustment layer ${layer.state.name}.`);
		if (layer.precomposition !== null) admitFrame(layer.precomposition, rasterizer);
	}
}
