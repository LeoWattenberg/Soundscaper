/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionCompositionFrame, MotionEvaluatedLayer } from './motion-composition-evaluation.ts';
import { createMotionCamera, type MotionCamera } from './motion-camera.ts';
import { inverseMotionAffineMatrix } from './motion-transform-inverse.ts';
import { multiplyMotionMatrices, type MotionMatrix4 } from './motion-transform.ts';
import { motionSurfaceLength } from './motion-surface.ts';

export const MOTION_MAXIMUM_DEPTH_PLANES = 64;
export const MOTION_MAXIMUM_DEPTH_RAYS = 67_108_864;
export const MOTION_DEPTH_SCRATCH_BYTES = MOTION_MAXIMUM_DEPTH_PLANES * 6 * Float64Array.BYTES_PER_ELEMENT;
export interface MotionDepthPlanePlan { readonly layer: MotionEvaluatedLayer; readonly cameraToLocal: MotionMatrix4 }
export interface MotionDepthPlan { readonly camera: MotionCamera; readonly planes: readonly MotionDepthPlanePlan[] }
export function isMotionPixelLayer(layer: MotionEvaluatedLayer): boolean { return !['null', 'camera', 'light', 'adjustment'].includes(layer.state.kind); }

/** Validate the complete ray workload and every inverse before source or target acquisition. */
export function planMotionDepth(frame: MotionCompositionFrame): MotionDepthPlan {
	const camera = createMotionCamera(frame);
	if (camera.aperture !== 0) throw new Error('Motion camera aperture requires a declared depth-of-field sampling quality.');
	const layers = frame.layers.filter((layer) => layer.state.is3D && isMotionPixelLayer(layer));
	if (layers.length > MOTION_MAXIMUM_DEPTH_PLANES || motionSurfaceLength(frame.width, frame.height) / 4 * layers.length > MOTION_MAXIMUM_DEPTH_RAYS) throw new RangeError('Motion depth ray workload exceeds its plane/ray budget; reduce the canvas size or isolate layers in a precomposition.');
	return Object.freeze({ camera, planes: Object.freeze(layers.map((layer) => Object.freeze({ layer, cameraToLocal: multiplyMotionMatrices(inverseMotionAffineMatrix(layer.worldMatrix), camera.world) }))) });
}
