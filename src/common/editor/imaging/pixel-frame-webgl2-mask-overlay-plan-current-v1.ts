/* SPDX-License-Identifier: AGPL-3.0-only */

import { readPixelFrameWebGl2MaskCheckpointPlanCurrentV1,
	type PixelFrameWebGl2MaskCheckpointCurrentV1 } from './pixel-frame-webgl2-mask-plan-current-v1.ts';
import { imageDevelopMaskTransformsCurrentV1, assertImageDevelopMaskOverlayBudgetCurrentV1,
	type ImageDevelopMaskTransformCurrentV1 } from './image-develop-mask-plan-current-v1.ts';
import { preparePixelFrameWebGl2GeometryCurrentV1, type PreparedPixelFrameWebGl2GeometryCurrentV1 } from './pixel-frame-webgl2-geometry-current-v1.ts';
import { planImageLensDistortionV1, type ImageLensDistortionPlanV1 } from './image-lens-distortion-plan-v1.ts';
import type { ImageDevelopMaskBindingPlanV1 } from './image-develop-mask-plan-v1.ts';

type Extent = Readonly<{ width: number; height: number }>;
type Transform = ImageDevelopMaskTransformCurrentV1;
export type PixelFrameWebGl2MaskOverlayStepCurrentV1 = Readonly<{
	readonly ordinal: number; readonly source: Extent; readonly output: Extent; readonly transform: Transform;
}> & (Readonly<{ kind: 'geometry'; geometry: Readonly<PreparedPixelFrameWebGl2GeometryCurrentV1> }>
	| Readonly<{ kind: 'lens-distortion'; lens: Readonly<ImageLensDistortionPlanV1> }>);
export interface PreparedPixelFrameWebGl2MaskOverlayCurrentV1 {
	readonly checkpointPlan: unknown;
	readonly checkpoint: Readonly<PixelFrameWebGl2MaskCheckpointCurrentV1>;
	readonly binding: Readonly<ImageDevelopMaskBindingPlanV1>;
	readonly suffix: readonly Transform[];
	readonly sourceExtent: Extent;
	readonly finalExtent: Extent;
	readonly steps: readonly PixelFrameWebGl2MaskOverlayStepCurrentV1[];
	readonly maximumSuffixPixels: number;
	readonly projectionTextureBytes: number;
	readonly retainedHostBytes: number;
	readonly nativeReadbackBytes: number;
	readonly uniformBytes: 128;
	readonly gpuPeakBytes: number;
	readonly cpuProjectionBytes: number;
	readonly replayRetainedBytes: number;
	/** Standalone lower bound only: excludes A's graph pools/brushes, receipt
	 * canonical scratch and every image/LUT/reference/presentation allocation. */
	readonly componentBytes: number;
	readonly supported: boolean;
}
const PREPARED = new WeakMap<object, Readonly<PreparedPixelFrameWebGl2MaskOverlayCurrentV1>>();
const extent = (width: number, height: number): Extent => Object.freeze({ width, height });

/** Consume the genuine Current selected binding, including disabled/neutral
 * observation. The exact transform capability array remains enrolled; copied
 * suffixes or lookalike binding objects cannot construct an overlay plan.
 * Existing preparers own all geometry/coordinate mathematics. */
export function preparePixelFrameWebGl2MaskOverlayCurrentV1(value: unknown): Readonly<PreparedPixelFrameWebGl2MaskOverlayCurrentV1> {
	const owner = readPixelFrameWebGl2MaskCheckpointPlanCurrentV1(value), selected = owner.selectedExecutionIndex;
	if (selected === undefined) throw new RangeError('GPU mask overlay requires a selected executed checkpoint.');
	const checkpoint = owner.executedCheckpoints[selected];
	if (!checkpoint || checkpoint.executionIndex !== selected || !checkpoint.selected || checkpoint.mode === 'declared-only') {
		throw new TypeError('GPU mask overlay lost its exact selected checkpoint.');
	}
	const binding = checkpoint.binding, suffix = imageDevelopMaskTransformsCurrentV1(binding);
	if (suffix !== checkpoint.suffix) throw new TypeError('GPU mask overlay requires the original Current transform capabilities.');
	assertImageDevelopMaskOverlayBudgetCurrentV1(binding);
	const sourceExtent = extent(checkpoint.width, checkpoint.height), steps: PixelFrameWebGl2MaskOverlayStepCurrentV1[] = [];
	let current = sourceExtent, maximumPixels = current.width * current.height, supported = true;
	for (const [ordinal, transform] of suffix.entries()) {
		if (transform.kind === 'geometry') {
			const geometry = preparePixelFrameWebGl2GeometryCurrentV1(transform.geometry, { schemaVersion: 1, ...current,
				sampleFormat: 'float32', primaries: owner.sourceDescriptor.primaries, transfer: 'linear' });
			const output = extent(geometry.descriptor.width, geometry.descriptor.height);
			steps.push(Object.freeze({ ordinal, kind: 'geometry', transform, source: current, output, geometry }));
			supported &&= geometry.supported; current = output;
		} else {
			const lens = planImageLensDistortionV1(transform.amount, current.width, current.height), rounded = Math.fround(lens.coefficient);
			supported &&= Number.isFinite(rounded) && (lens.coefficient === 0 || rounded !== 0);
			steps.push(Object.freeze({ ordinal, kind: 'lens-distortion', transform, source: current, output: current, lens }));
		}
		maximumPixels = Math.max(maximumPixels, current.width * current.height);
	}
	if (current.width !== owner.finalDescriptor.width || current.height !== owner.finalDescriptor.height) {
		throw new RangeError('GPU overlay suffix differs from its complete captured final extent.');
	}
	const retainedHostBytes = current.width * current.height, textureBytes = steps.length ? maximumPixels * 2 : 0;
	const nativeReadbackBytes = Math.min(current.width, 4096) * 16, uniformBytes = 128 as const;
	const gpuPeakBytes = textureBytes + retainedHostBytes + nativeReadbackBytes + uniformBytes;
	const cpuProjectionBytes = steps.length ? maximumPixels * 13 : 0;
	const plan = Object.freeze({ checkpointPlan: value, checkpoint, binding, suffix, sourceExtent, finalExtent: current, steps: Object.freeze(steps),
		maximumSuffixPixels: maximumPixels, projectionTextureBytes: textureBytes, retainedHostBytes, nativeReadbackBytes, uniformBytes, gpuPeakBytes, cpuProjectionBytes,
		replayRetainedBytes: retainedHostBytes, componentBytes: binding.workingBytes + Math.max(gpuPeakBytes, cpuProjectionBytes + retainedHostBytes), supported });
	PREPARED.set(plan, plan); return plan;
}
export function isPixelFrameWebGl2MaskOverlayCurrentV1(value: unknown): value is Readonly<PreparedPixelFrameWebGl2MaskOverlayCurrentV1> {
	return typeof value === 'object' && value !== null && PREPARED.has(value);
}
export function readPixelFrameWebGl2MaskOverlayCurrentV1(value: unknown): Readonly<PreparedPixelFrameWebGl2MaskOverlayCurrentV1> {
	if (!isPixelFrameWebGl2MaskOverlayCurrentV1(value)) throw new TypeError('GPU overlay requires its private selected plan.');
	return PREPARED.get(value)!;
}
