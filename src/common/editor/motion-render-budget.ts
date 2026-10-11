/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionCompositionFrame } from './motion-composition-evaluation.ts';
import type { MotionCompositor, MotionRasterizer } from './motion-composition-renderer.ts';
import { motionSurfaceLength } from './motion-surface.ts';
import { motionAdjustmentApplies } from './motion-adjustment-rendering.ts';
import { isMotionPixelLayer, MOTION_DEPTH_SCRATCH_BYTES } from './motion-depth-plan.ts';

export const MOTION_DEFAULT_WORKING_BYTES = 512 * 1024 * 1024;

/** Conservative peak for retained ancestor targets, isolated children, raster scratch and readback. */
export function estimateMotionFrameWorkingBytes(frame: MotionCompositionFrame, rasterizer: MotionRasterizer, compositor: MotionCompositor): number {
	const pixels = motionSurfaceLength(frame.width, frame.height) * Float32Array.BYTES_PER_ELEMENT;
	const layerIds = new Set(frame.layers.map((layer) => layer.state.id));
	const matteIds = new Set(frame.layers.flatMap((layer) => layer.state.matte && layerIds.has(layer.state.matte.layerId) ? [layer.state.matte.layerId] : []));
	let retained = pixels * ((compositor.retainedSurfaceCount ?? 3) + matteIds.size);
	let peak = retained + pixels;
	const depthLayers = frame.layers.filter((layer) => layer.state.is3D && isMotionPixelLayer(layer));
	let depthSources = 0; let depthPeak = 0;
	for (const layer of depthLayers) {
		let sourceBytes = 16; let processing = 16;
		if (layer.precomposition) {
			const child = layer.precomposition; sourceBytes = motionSurfaceLength(child.width, child.height) * Float32Array.BYTES_PER_ELEMENT;
			processing = Math.max(estimateMotionFrameWorkingBytes(child, rasterizer, compositor), sourceBytes,
				layer.state.masks.length ? rasterizer.estimateMaskWorkingBytes!(child.width, child.height, layer.state.masks) : 0,
				layer.state.effects.some((effect) => effect.enabled) ? rasterizer.estimateEffectWorkingBytes!(child.width, child.height, layer.state.effects) : 0);
			// Expanded effects can return more pixels than the child grid; the processing bound covers them.
			if (layer.state.effects.some((effect) => effect.enabled)) sourceBytes = processing;
		} else if (layer.sourceAvailable) sourceBytes = processing = rasterizer.estimateSourceWorkingBytes!(layer, frame);
		if (!Number.isSafeInteger(processing) || processing < 16) throw new RangeError('Motion 3D local rasterizer supplied an invalid working-memory estimate.');
		depthPeak = Math.max(depthPeak, depthSources + processing); depthSources += sourceBytes;
	}
	if (depthLayers.length) peak = Math.max(peak, retained + pixels * 2 + MOTION_DEPTH_SCRATCH_BYTES + Math.max(depthPeak, depthSources));
	// Source/matte work may run while a depth group still owns all its local rasters.
	retained += depthSources;
	for (const layer of frame.layers) {
		if (['null', 'camera', 'light'].includes(layer.state.kind) || layer.state.is3D && isMotionPixelLayer(layer)) continue;
		if (layer.state.kind === 'adjustment') {
			if (motionAdjustmentApplies(layer, frame)) {
				const processing = Math.max(pixels, layer.state.masks.length ? rasterizer.estimateMaskWorkingBytes!(frame.width, frame.height, layer.state.masks) : 0,
					rasterizer.estimateEffectWorkingBytes!(frame.width, frame.height, layer.state.effects));
				if (!Number.isSafeInteger(processing) || processing < pixels) throw new RangeError('Motion adjustment supplied an invalid working-memory estimate.');
				peak = Math.max(peak, retained + pixels * 6 + processing);
			}
			continue;
		}
		const matteCopy = layer.state.matte ? pixels : 0;
		if (layer.precomposition !== null) {
			const child = layer.precomposition;
			const childPixels = motionSurfaceLength(child.width, child.height) * Float32Array.BYTES_PER_ELEMENT;
			const processing = Math.max(childPixels, layer.state.masks.length ? rasterizer.estimateMaskWorkingBytes!(child.width, child.height, layer.state.masks) : 0,
				layer.state.effects.some((effect) => effect.enabled) ? rasterizer.estimateEffectWorkingBytes!(child.width, child.height, layer.state.effects) : 0);
			if (!Number.isSafeInteger(processing) || processing < childPixels) throw new RangeError('Motion mask rasterizer supplied an invalid working-memory estimate.');
			const transform = processing + pixels + matteCopy;
			peak = Math.max(peak, retained + Math.max(transform, estimateMotionFrameWorkingBytes(child, rasterizer, compositor)));
		} else if (layer.sourceAvailable && (layer.state.masks.length || layer.state.effects.some((effect) => effect.enabled))) {
			const processing = rasterizer.estimateSourceWorkingBytes!(layer, frame);
			if (!Number.isSafeInteger(processing) || processing < 16) throw new RangeError('Motion local rasterizer supplied an invalid working-memory estimate.');
			peak = Math.max(peak, retained + processing + pixels + matteCopy);
		} else {
			const sourceBytes = layer.sourceAvailable ? (rasterizer.estimateWorkingBytes?.(layer, frame) ?? pixels * 2) : pixels;
			if (!Number.isSafeInteger(sourceBytes) || sourceBytes < pixels) throw new RangeError('Motion rasterizer supplied an invalid working-memory estimate.');
			peak = Math.max(peak, retained + sourceBytes + matteCopy);
		}
	}
	return peak;
}

export function assertMotionWorkingBudget(requiredBytes: number, maximumBytes: number): void {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 4 * 1024 * 1024 * 1024) throw new RangeError('Motion working-memory budget must be a positive integer no greater than 4 GiB.');
	if (requiredBytes > maximumBytes) throw new RangeError(`Motion working surfaces require ${requiredBytes} bytes, exceeding the ${maximumBytes}-byte budget; reduce the canvas size or use the CPU compositor.`);
}
