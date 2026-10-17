/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAsset } from './motion-asset.ts';
import type { MotionLayer } from './motion-composition.ts';
import type { EvaluatedMotionState } from './motion-property-evaluation.ts';
import type { MotionSurface } from './motion-surface.ts';
import { motionSurfaceLength } from './motion-surface.ts';
import { multiplyMotionMatrices, type MotionMatrix4 } from './motion-transform.ts';
import { motionTextAnimationBounds } from './motion-text-animation.ts';
import { planMotionShapeOperators } from './motion-shape-operator-plan.ts';

export type MotionSourceOrigin = readonly [number, number];
export interface MotionLocalRaster { readonly surface: MotionSurface; readonly origin: MotionSourceOrigin }
export interface MotionLocalSourceBounds { readonly width: number; readonly height: number; readonly origin: MotionSourceOrigin; readonly empty: boolean }

/** Local pixel (0,0) is this layer coordinate, never a persisted transform or renderer handle. */
export function motionSourceWorldMatrix(world: MotionMatrix4, origin: MotionSourceOrigin): MotionMatrix4 {
	return multiplyMotionMatrices(world, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, origin[0], origin[1], 0, 1]);
}
export function motionSourceRasterMatrix(origin: MotionSourceOrigin): MotionMatrix4 {
	return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -origin[0], -origin[1], 0, 1];
}

/** Bezier control hulls conservatively enclose every curve, including negative coordinates. */
export function motionLocalSourceBounds(state: EvaluatedMotionState<MotionLayer>, assets: ReadonlyMap<string, MotionAsset>): MotionLocalSourceBounds {
	if (state.kind === 'image' || state.kind === 'footage') {
		const asset = assets.get(state.assetId);
		if (!asset || asset.kind !== state.kind) throw new Error(`Missing motion ${state.kind} asset ${state.assetId}.`);
		return bounds(0, 0, asset.width, asset.height);
	}
	if (state.kind === 'solid') return dimensions(state.size);
	if (state.kind === 'text') return state.document.animators?.some((item) => item.enabled) ? motionTextAnimationBounds(state.document) : dimensions(state.document.boxSize);
	if (state.kind !== 'shapes') throw new Error(`Motion ${state.kind} has no local raster source.`);
	if (state.operators?.some((item) => item.enabled)) return planMotionShapeOperators(state).bounds;
	let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
	for (const shape of state.shapes) {
		if (shape.stroke && (!Number.isFinite(shape.stroke.width) || shape.stroke.width < 0 || shape.stroke.width > 32768)) throw new RangeError('Motion stroke width is outside the rendering range.');
		if (!shape.fill && (!shape.stroke || shape.stroke.width === 0)) continue;
		// Stroke miter limit is explicitly four times the half-width in both raster paths.
		const padding = shape.stroke ? shape.stroke.width * 2 : 0;
		for (const vertex of shape.path.vertices) for (const offset of [[0, 0], vertex.inTangent, vertex.outTangent]) {
			const x = vertex.point[0] + offset[0]!; const y = vertex.point[1] + offset[1]!;
			left = Math.min(left, x - padding); top = Math.min(top, y - padding);
			right = Math.max(right, x + padding); bottom = Math.max(bottom, y + padding);
		}
	}
	return left === Infinity ? empty() : bounds(left, top, right, bottom);
}
function dimensions(size: readonly [number, number]): MotionLocalSourceBounds {
	if (size.some((value) => !Number.isFinite(value) || value < 0 || value > 32768)) throw new RangeError('Motion local source dimensions are outside the rendering range.');
	return size.some((value) => value === 0) ? empty() : bounds(0, 0, ...size);
}
function empty(): MotionLocalSourceBounds { return { width: 1, height: 1, origin: [0, 0], empty: true }; }
function bounds(left: number, top: number, right: number, bottom: number): MotionLocalSourceBounds {
	const x = Math.floor(left); const y = Math.floor(top); const width = Math.max(1, Math.ceil(right) - x); const height = Math.max(1, Math.ceil(bottom) - y);
	if (![x, y, width, height].every(Number.isSafeInteger)) throw new RangeError('Motion local raster coordinates exceed exact dimensions.');
	motionSurfaceLength(width, height);
	return { origin: [x, y], width, height, empty: false };
}
