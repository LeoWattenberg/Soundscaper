/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionCompositionFrame } from './motion-composition-evaluation.ts';
import type { MotionCompositor, MotionRasterizer } from './motion-composition-renderer.ts';
import { motionSurfaceLength } from './motion-surface.ts';

export const MOTION_DEFAULT_WORKING_BYTES = 512 * 1024 * 1024;

/** Conservative peak for retained ancestor targets, isolated children, raster scratch and readback. */
export function estimateMotionFrameWorkingBytes(frame: MotionCompositionFrame, rasterizer: MotionRasterizer, compositor: MotionCompositor): number {
	const pixels = motionSurfaceLength(frame.width, frame.height) * Float32Array.BYTES_PER_ELEMENT;
	const retained = pixels * (compositor.retainedSurfaceCount ?? 3);
	let peak = retained + pixels;
	for (const layer of frame.layers) {
		if (layer.state.kind === 'null') continue;
		if (layer.precomposition !== null) {
			const child = layer.precomposition;
			const transform = motionSurfaceLength(child.width, child.height) * Float32Array.BYTES_PER_ELEMENT + pixels;
			peak = Math.max(peak, retained + Math.max(transform, estimateMotionFrameWorkingBytes(child, rasterizer, compositor)));
		} else {
			const sourceBytes = layer.sourceAvailable ? (rasterizer.estimateWorkingBytes?.(layer, frame) ?? pixels * 2) : pixels;
			if (!Number.isSafeInteger(sourceBytes) || sourceBytes < pixels) throw new RangeError('Motion rasterizer supplied an invalid working-memory estimate.');
			peak = Math.max(peak, retained + sourceBytes);
		}
	}
	return peak;
}

export function assertMotionWorkingBudget(requiredBytes: number, maximumBytes: number): void {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 4 * 1024 * 1024 * 1024) throw new RangeError('Motion working-memory budget must be a positive integer no greater than 4 GiB.');
	if (requiredBytes > maximumBytes) throw new RangeError(`Motion working surfaces require ${requiredBytes} bytes, exceeding the ${maximumBytes}-byte budget; reduce the canvas size or use the CPU compositor.`);
}
