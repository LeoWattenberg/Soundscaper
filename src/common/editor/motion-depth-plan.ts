/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionCompositionFrame, MotionEvaluatedLayer } from './motion-composition-evaluation.ts';
import { createMotionCamera, type MotionCamera } from './motion-camera.ts';
import { inverseMotionAffineMatrix } from './motion-transform-inverse.ts';
import { multiplyMotionMatrices, type MotionMatrix4 } from './motion-transform.ts';
import { motionSurfaceLength } from './motion-surface.ts';
import { motionDepthOfFieldSamples } from './motion-temporal-settings.ts';
import { motionLensSamples } from './motion-lens-sampling.ts';
import type { MotionVector2 } from './motion-property.ts';

export const MOTION_MAXIMUM_DEPTH_PLANES = 64;
export const MOTION_MAXIMUM_DEPTH_RAYS = 67_108_864;
export const MOTION_DEPTH_SCRATCH_BYTES = (MOTION_MAXIMUM_DEPTH_PLANES * 6 + 4) * Float64Array.BYTES_PER_ELEMENT;
export interface MotionDepthPlanePlan { readonly layer: MotionEvaluatedLayer; readonly cameraToLocal: MotionMatrix4; readonly worldToLocal: MotionMatrix4 }
export interface MotionDepthPlan { readonly camera: MotionCamera; readonly planes: readonly MotionDepthPlanePlan[]; readonly lenses: readonly MotionVector2[] }
export function isMotionPixelLayer(layer: MotionEvaluatedLayer): boolean { return !['null', 'camera', 'light', 'adjustment'].includes(layer.state.kind); }

/** Validate the complete ray workload and every inverse before source or target acquisition. */
export function planMotionDepth(frame: MotionCompositionFrame, requestedLensSamples?: number): MotionDepthPlan {
	const camera = createMotionCamera(frame);
	const authoredSamples = motionDepthOfFieldSamples(frame.depthOfFieldSamples ?? 16); const count = motionDepthOfFieldSamples(requestedLensSamples ?? authoredSamples);
	if (count > authoredSamples) throw new RangeError('Motion depth-of-field preview samples cannot exceed authored quality.');
	const lenses = motionLensSamples(camera.aperture, count);
	const layers = frame.layers.filter((layer) => layer.state.is3D && isMotionPixelLayer(layer));
	if (layers.length > MOTION_MAXIMUM_DEPTH_PLANES || motionSurfaceLength(frame.width, frame.height) / 4 * layers.length * lenses.length > MOTION_MAXIMUM_DEPTH_RAYS) throw new RangeError('Motion depth ray workload exceeds its plane/ray budget; reduce the canvas size or isolate layers in a precomposition.');
	return Object.freeze({ camera, lenses, planes: Object.freeze(layers.map((layer) => {
		const worldToLocal = inverseMotionAffineMatrix(layer.worldMatrix); return Object.freeze({ layer, worldToLocal, cameraToLocal: multiplyMotionMatrices(worldToLocal, camera.world) });
	})) });
}
