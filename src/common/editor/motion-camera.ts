/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionCompositionFrame } from './motion-composition-evaluation.ts';
import type { MotionVector2, MotionVector3 } from './motion-property.ts';
import type { MotionMatrix4 } from './motion-transform.ts';
import { inverseMotionAffineMatrix, transformMotionDirection, transformMotionPoint } from './motion-transform-inverse.ts';
import { motionSurfaceLength } from './motion-surface.ts';
import { motionNumber } from './motion-values.ts';

export interface MotionCamera {
	readonly width: number; readonly height: number; readonly projection: 'perspective' | 'orthographic';
	readonly zoom: number; readonly near: number; readonly far: number; readonly focusDistance: number; readonly aperture: number;
	readonly world: MotionMatrix4; readonly view: MotionMatrix4;
}
/** The ray parameter is camera-local forward depth, including parented/nonuniform camera rigs. */
export interface MotionCameraRay { readonly origin: MotionVector3; readonly direction: MotionVector3 }
export interface MotionPlaneIntersection { readonly depth: number; readonly local: MotionVector3; readonly world: MotionVector3 }

/** Topmost active camera wins. The implicit centered camera preserves the z=0 composition grid. */
export function createMotionCamera(frame: MotionCompositionFrame): MotionCamera {
	motionSurfaceLength(frame.width, frame.height);
	const layer = frame.layers.find((layer) => layer.state.kind === 'camera'); const state = layer?.state;
	const explicit = state?.kind === 'camera' ? state : null;
	const zoom = motionNumber(explicit?.zoom ?? Math.max(frame.width, frame.height), 'camera zoom', 1e-6, 1e9);
	const world: MotionMatrix4 = layer?.worldMatrix ?? Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, frame.width / 2, frame.height / 2, -zoom, 1]);
	const near = motionNumber(explicit?.near ?? 0.001, 'camera near', 0.001, 1e9);
	const far = motionNumber(explicit?.far ?? 1e9, 'camera far', near, 1e9);
	if (far <= near) throw new RangeError('Motion camera far distance must exceed its near distance.');
	return Object.freeze({ width: frame.width, height: frame.height, projection: explicit?.projection ?? 'perspective', zoom, near,
		far,
		focusDistance: motionNumber(explicit?.focusDistance ?? zoom, 'camera focus distance', 1e-6, 1e9), aperture: motionNumber(explicit?.aperture ?? 0, 'camera aperture', 0, 32768), world, view: inverseMotionAffineMatrix(world) });
}

/** Lens offsets are camera-local world units; callers derive them from a declared sampling quality/aperture. */
export function motionCameraRay(camera: MotionCamera, point: MotionVector2, lens: MotionVector2 = [0, 0]): MotionCameraRay {
	const scale = camera.zoom / Math.max(camera.width, camera.height);
	const x = point[0] - camera.width / 2; const y = point[1] - camera.height / 2;
	const origin: MotionVector3 = camera.projection === 'perspective' ? [lens[0], lens[1], 0] : [x / scale + lens[0], y / scale + lens[1], 0];
	const direction: MotionVector3 = camera.projection === 'perspective' ? [x / camera.zoom - lens[0] / camera.focusDistance, y / camera.zoom - lens[1] / camera.focusDistance, 1]
		: [-lens[0] / camera.focusDistance, -lens[1] / camera.focusDistance, 1];
	return { origin: transformMotionPoint(camera.world, origin), direction: transformMotionDirection(camera.world, direction) };
}
export function projectMotionCameraPoint(camera: MotionCamera, world: MotionVector3, lens: MotionVector2 = [0, 0]): Readonly<{ point: MotionVector2; depth: number }> | null {
	const local = transformMotionPoint(camera.view, world); const depth = local[2];
	if (!local.every(Number.isFinite)) throw new RangeError('Motion camera projection exceeds its finite range.');
	if (depth < camera.near || depth > camera.far) return null;
	const factor = camera.projection === 'perspective' ? camera.zoom / depth : camera.zoom / Math.max(camera.width, camera.height);
	return { point: [camera.width / 2 + (local[0] - lens[0] * (1 - depth / camera.focusDistance)) * factor,
		camera.height / 2 + (local[1] - lens[1] * (1 - depth / camera.focusDistance)) * factor], depth };
}
export function intersectMotionPlane(ray: MotionCameraRay, inverseWorld: MotionMatrix4): MotionPlaneIntersection | null {
	const origin = transformMotionPoint(inverseWorld, ray.origin); const direction = transformMotionDirection(inverseWorld, ray.direction);
	if (Math.abs(direction[2]) <= 1e-12 * Math.hypot(...direction)) return null;
	const depth = -origin[2] / direction[2]; if (!Number.isFinite(depth)) return null;
	return { depth, local: [origin[0] + direction[0] * depth, origin[1] + direction[1] * depth, 0],
		world: [ray.origin[0] + ray.direction[0] * depth, ray.origin[1] + ray.direction[1] * depth, ray.origin[2] + ray.direction[2] * depth] };
}
