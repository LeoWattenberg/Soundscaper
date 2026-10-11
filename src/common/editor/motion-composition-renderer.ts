/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertMotionFrameConsumed, type MotionCompositionFrame, type MotionEvaluatedLayer } from './motion-composition-evaluation.ts';
import { assertMotion2DMatrix, compositeMotionSurfaces, createMotionSurface, transformMotionSurface, validateMotionSurface, type MotionBlendMode, type MotionSurface } from './motion-surface.ts';
import type { MotionColor } from './motion-property.ts';
import { assertMotionWorkingBudget, estimateMotionFrameWorkingBytes, MOTION_DEFAULT_WORKING_BYTES } from './motion-render-budget.ts';

export interface MotionRasterizer {
	/** Peak scratch plus returned pixels; the default assumes two composition-sized float surfaces. */
	estimateWorkingBytes?(layer: MotionEvaluatedLayer, target: MotionCompositionFrame): number;
	/** Rasterize source plus its world transform into the target composition's pixel grid. */
	rasterize(layer: MotionEvaluatedLayer, target: MotionCompositionFrame, signal?: AbortSignal): Promise<MotionSurface>;
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
	admitFrame(frame);
	assertMotionWorkingBudget(estimateMotionFrameWorkingBytes(frame, options.rasterizer, options.compositor ?? motionCpuCompositor), options.maximumWorkingBytes ?? MOTION_DEFAULT_WORKING_BYTES);
	const consumed: string[] = [];
	const render = async (current: MotionCompositionFrame): Promise<MotionSurface> => {
		options.signal?.throwIfAborted();
		const target = (options.compositor ?? motionCpuCompositor).begin(current.width, current.height, current.background);
		consumed.push(current.requiredOperationIds[0]!);
		try {
			for (const layer of [...current.layers].reverse()) {
				options.signal?.throwIfAborted();
				if (layer.state.kind !== 'null') {
					let source: MotionSurface;
					if (layer.precomposition !== null) source = transformMotionSurface(await render(layer.precomposition), current.width, current.height, layer.worldMatrix);
					else if (!layer.sourceAvailable) source = createMotionSurface(current.width, current.height);
					else source = await options.rasterizer.rasterize(layer, current, options.signal);
					options.signal?.throwIfAborted();
					validateMotionSurface(source);
					target.composite(source, layer.state.blendMode, layer.state.transform.opacity);
				}
				consumed.push(...layer.operations.map((operation) => operation.id));
			}
			return target.finish();
		} finally { target.dispose(); }
	};
	const surface = await render(frame);
	options.signal?.throwIfAborted();
	assertMotionFrameConsumed(frame, consumed);
	return Object.freeze({ ...surface, consumedOperationIds: Object.freeze(consumed) });
}

function admitFrame(frame: MotionCompositionFrame): void {
	for (const layer of frame.layers) {
		if (layer.state.is3D) throw new Error(`Unsupported 3D motion layer ${layer.state.name}.`);
		assertMotion2DMatrix(layer.worldMatrix);
		for (const operation of layer.operations) {
			if (['effect', 'mask', 'matte', 'camera', 'light'].includes(operation.kind)) throw new Error(`Unsupported motion ${operation.kind} ${operation.sourceId}; its renderer is unavailable.`);
		}
		if (layer.state.kind === 'adjustment') throw new Error(`Unsupported motion adjustment layer ${layer.state.name}.`);
		if (layer.precomposition !== null) admitFrame(layer.precomposition);
	}
}
