/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertMotionFrameConsumed, type MotionCompositionFrame, type MotionEvaluatedLayer } from './motion-composition-evaluation.ts';
import { assertMotion2DMatrix, compositeMotionSurfaces, createMotionSurface, validateMotionSurface, type MotionBlendMode, type MotionSurface } from './motion-surface.ts';
import type { MotionColor } from './motion-property.ts';
import { assertMotionWorkingBudget, estimateMotionFrameWorkingBytes, MOTION_DEFAULT_WORKING_BYTES } from './motion-render-budget.ts';
import type { MotionLocalRaster } from './motion-local-raster.ts';
import { assertMotionMaskParameters, type MotionMaskRasterizer } from './motion-mask-rendering.ts';
import { motionEffectParameters, type MotionEffectRasterizer } from './motion-effect-rendering.ts';
import { assertMotionAcyclic } from './motion-project-graph.ts';
import { applyMotionMatte } from './motion-matte-rendering.ts';
import { renderMotionLayerSource, renderMotionLayerLocalSource } from './motion-render-layer-source.ts';
import { motionAdjustmentApplies, renderMotionAdjustment } from './motion-adjustment-rendering.ts';
import { isMotionPixelLayer, planMotionDepth } from './motion-depth-plan.ts';
import { compositeMotionDepthPlanes, type MotionDepthPlane } from './motion-depth-compositing.ts';
import { planMotionLighting } from './motion-lighting-plan.ts';

export interface MotionRasterizer extends Partial<MotionMaskRasterizer>, Partial<MotionEffectRasterizer> {
	readonly supportedSourceOperations?: readonly ('shape-operator' | 'text-animator')[];
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
	/** Replace a validated whole backdrop, without borrowing or mutating source pixels. */
	replace?(source: MotionSurface): void;
	finish(): MotionSurface;
	dispose(): void;
}
export interface MotionCompositor { readonly retainedSurfaceCount?: 1 | 3; readonly supportsReplacement?: boolean; begin(width: number, height: number, background: MotionColor): MotionCompositeTarget }
export interface MotionRenderResult extends MotionSurface { readonly consumedOperationIds: readonly string[] }

export const motionCpuCompositor: MotionCompositor = Object.freeze({ retainedSurfaceCount: 1, supportsReplacement: true, begin(width: number, height: number, background: MotionColor): MotionCompositeTarget {
	let surface: MotionSurface | null = createMotionSurface(width, height, background);
	return { composite(source, mode, opacity) { if (!surface) throw new Error('Motion composition target is disposed.'); compositeMotionSurfaces(surface, source, mode, opacity); },
		replace(source) { if (!surface) throw new Error('Motion composition target is disposed.'); validateMotionSurface(source); if (source.width !== width || source.height !== height) throw new RangeError('Motion replacement dimensions do not match the backdrop.'); surface.pixels.set(source.pixels); },
		finish() { if (!surface) throw new Error('Motion composition target is disposed.'); return surface; }, dispose() { surface = null; } };
} });

/** Identical evaluated input and rasterizer serve seeking, preview, thumbnails, delivery and linked sources. */
export async function renderMotionCompositionFrame(frame: MotionCompositionFrame, options: Readonly<{
	rasterizer: MotionRasterizer; compositor?: MotionCompositor; signal?: AbortSignal; maximumWorkingBytes?: number; depthOfFieldSamples?: number;
}>): Promise<MotionRenderResult> {
	options.signal?.throwIfAborted();
	admitFrame(frame, options.rasterizer, options.compositor ?? motionCpuCompositor, options.depthOfFieldSamples);
	assertMotionWorkingBudget(estimateMotionFrameWorkingBytes(frame, options.rasterizer, options.compositor ?? motionCpuCompositor), options.maximumWorkingBytes ?? MOTION_DEFAULT_WORKING_BYTES);
	const consumed: string[] = [];
	const render = async (current: MotionCompositionFrame): Promise<MotionSurface> => {
		options.signal?.throwIfAborted();
		const target = (options.compositor ?? motionCpuCompositor).begin(current.width, current.height, current.background);
		const layers = new Map(current.layers.map((layer) => [layer.state.id, layer]));
		const matteIds = new Set(current.layers.flatMap((layer) => layer.state.matte ? [layer.state.matte.layerId] : []));
		const matteCache = new Map<string, MotionSurface>();
		const processed = new Set<string>();
		const count = current === frame || options.depthOfFieldSamples === undefined ? options.depthOfFieldSamples : Math.min(options.depthOfFieldSamples, current.depthOfFieldSamples ?? 16);
		const depth = planMotionDepth(current, count); const depthPlans = new Map(depth.planes.map((plane) => [plane.layer.state.id, plane]));
		const lighting = planMotionLighting(current, depth);
		consumed.push(current.requiredOperationIds[0]!);
		const mark = (layer: MotionEvaluatedLayer) => { if (!processed.has(layer.state.id)) { processed.add(layer.state.id); consumed.push(...layer.operations.map((operation) => operation.id)); } };
		const sourceFor = async (layer: MotionEvaluatedLayer): Promise<MotionSurface> => {
			const cached = matteCache.get(layer.state.id); if (cached) return cached;
			const plane = depthPlans.get(layer.state.id);
			let source = plane ? await compositeMotionDepthPlanes(createMotionSurface(current.width, current.height), depth.camera,
				[{ ...plane, local: await renderMotionLayerLocalSource(layer, current, { ...options, renderPrecomposition: render }), opacity: 1 }], options.signal, lighting, depth.lenses)
				: await renderMotionLayerSource(layer, current, { ...options, renderPrecomposition: render });
			if (layer.state.matte) {
				const matte = layers.get(layer.state.matte.layerId);
				source = applyMotionMatte(source, matte ? await sourceFor(matte) : null, layer.state.matte.mode, matte?.state.transform.opacity);
			}
			if (matteIds.has(layer.state.id)) matteCache.set(layer.state.id, source);
			mark(layer);
			return source;
		};
		let group: MotionDepthPlane[] = [];
		const flushDepth = async () => {
			if (!group.length) return;
			const replacement = await compositeMotionDepthPlanes(target.finish(), depth.camera, group, options.signal, lighting, depth.lenses);
			if (!target.replace) throw new Error('Motion compositor omitted its admitted 3D replacement method.'); target.replace(replacement); group = [];
		};
		try {
			for (const layer of [...current.layers].reverse()) {
				options.signal?.throwIfAborted();
				if (['null', 'camera', 'light'].includes(layer.state.kind)) { mark(layer); continue; }
				const plane = depthPlans.get(layer.state.id);
				if (plane && !matteIds.has(layer.state.id)) {
					const local = await renderMotionLayerLocalSource(layer, current, { ...options, renderPrecomposition: render });
					const matte = layer.state.matte ? layers.get(layer.state.matte.layerId) : undefined;
					group.push({ ...plane, local, ...(layer.state.matte ? { matte: { surface: matte ? await sourceFor(matte) : null, opacity: matte?.state.transform.opacity ?? 1, mode: layer.state.matte.mode } } : {}) }); mark(layer); continue;
				}
				if (!matteIds.has(layer.state.id)) await flushDepth();
				if (layer.state.kind === 'adjustment') {
					if (motionAdjustmentApplies(layer, current)) {
						const matte = layer.state.matte ? layers.get(layer.state.matte.layerId) : undefined;
						const matteSurface = matte ? await sourceFor(matte) : null;
						const replacement = await renderMotionAdjustment(layer, target.finish(), { ...options, matte: matteSurface, matteOpacity: matte?.state.transform.opacity });
						if (!target.replace) throw new Error('Motion compositor omitted its admitted adjustment replacement method.');
						target.replace(replacement);
					}
					consumed.push(...layer.operations.map((operation) => operation.id)); continue;
				}
				const source = await sourceFor(layer);
				if (!matteIds.has(layer.state.id)) target.composite(source, layer.state.blendMode, layer.state.transform.opacity);
			}
			await flushDepth(); return target.finish();
		} finally { matteCache.clear(); target.dispose(); }
	};
	const surface = await render(frame);
	options.signal?.throwIfAborted();
	assertMotionFrameConsumed(frame, consumed);
	return Object.freeze({ ...surface, consumedOperationIds: Object.freeze(consumed) });
}

function admitFrame(frame: MotionCompositionFrame, rasterizer: MotionRasterizer, compositor: MotionCompositor, depthOfFieldSamples?: number, nested = false): void {
	const count = nested && depthOfFieldSamples !== undefined ? Math.min(depthOfFieldSamples, frame.depthOfFieldSamples ?? 16) : depthOfFieldSamples;
	const depth = planMotionDepth(frame, count);
	planMotionLighting(frame, depth);
	if (depth.planes.length && !compositor.supportsReplacement) throw new Error('Motion compositor cannot replace a 3D backdrop; use the CPU compositor.');
	const layers = new Map(frame.layers.map((layer) => [layer.state.id, layer]));
	assertMotionAcyclic(new Map(frame.layers.map((layer) => [layer.state.id, layer.state.matte ? [layer.state.matte.layerId] : []])), 'matte', 128);
	for (const layer of frame.layers) {
		if (['camera', 'light'].includes(layer.state.kind) && (layer.state.masks.length || layer.state.effects.some((effect) => effect.enabled) || layer.state.matte)) throw new Error(`Motion ${layer.state.kind} layers cannot consume pixel masks, effects or mattes.`);
		if (layer.state.is3D && layer.state.kind === 'adjustment') throw new Error('Motion 3D adjustment layers require an isolated precomposition.');
		if (layer.state.is3D && isMotionPixelLayer(layer) && (!rasterizer.rasterizeSource || !rasterizer.estimateSourceWorkingBytes)) throw new Error(`Motion 3D layer ${layer.state.name} requires a local-source renderer.`);
		if (!layer.state.is3D && !['camera', 'light', 'null'].includes(layer.state.kind)) assertMotion2DMatrix(layer.worldMatrix);
		for (const operation of layer.operations) {
			if ((operation.kind === 'shape-operator' || operation.kind === 'text-animator') && !rasterizer.supportedSourceOperations?.includes(operation.kind)) throw new Error(`Unsupported motion ${operation.kind} ${operation.sourceId}; its renderer is unavailable.`);
			if (operation.kind === 'effect' && (!rasterizer.rasterizeEffect || !rasterizer.estimateEffectWorkingBytes || layer.state.kind !== 'adjustment' && (!rasterizer.rasterizeSource || !rasterizer.estimateSourceWorkingBytes))) {
				throw new Error(`Unsupported motion effect ${operation.sourceId}; its local-source renderer is unavailable.`);
			}
			if (operation.kind === 'mask' && (!rasterizer.rasterizeMask || !rasterizer.estimateMaskWorkingBytes || layer.state.kind !== 'adjustment' && (!rasterizer.rasterizeSource || !rasterizer.estimateSourceWorkingBytes))) {
				throw new Error(`Unsupported motion mask ${operation.sourceId}; its local-source renderer is unavailable.`);
			}
		}
		if (layer.state.kind !== 'null') for (const mask of layer.state.masks) assertMotionMaskParameters(mask);
		if (layer.state.kind !== 'null') for (const effect of layer.state.effects) if (effect.enabled) motionEffectParameters(effect);
		for (const effect of layer.state.effects) if (effect.enabled && effect.type === 'corner-pin' && !rasterizer.supportedEffectTypes?.includes(effect.type)) throw new Error(`Motion corner-pin ${effect.id} is unavailable in this renderer.`);
		const matteSource = layer.state.matte ? layers.get(layer.state.matte.layerId) : null;
		if (matteSource && ['null', 'camera', 'light', 'adjustment'].includes(matteSource.state.kind)) throw new Error(`Motion matte source ${matteSource.state.name} is a non-pixel layer.`);
		if (layer.state.kind === 'adjustment' && motionAdjustmentApplies(layer, frame) && !compositor.supportsReplacement) throw new Error('Motion compositor cannot replace an adjustment backdrop; use the CPU compositor.');
		if (layer.precomposition !== null) admitFrame(layer.precomposition, rasterizer, compositor, depthOfFieldSamples, true);
	}
}
