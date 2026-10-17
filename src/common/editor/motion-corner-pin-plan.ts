/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionEffectPlan, MotionEvaluatedEffect } from './motion-effect-rendering.ts';
import type { MotionVector2 } from './motion-property.ts';
import { motionTrackingHomography, motionTrackingQuad, type MotionTrackingHomography, type MotionTrackingQuad } from './motion-tracking-homography.ts';
import { motionSurfaceLength } from './motion-surface.ts';

const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;
interface MotionCornerPinPlan extends MotionEffectPlan { readonly quad: MotionTrackingQuad; readonly inverse: MotionTrackingHomography }

/** Motion owns four animated vector parameters; the editorial scalar effect registry is unchanged. */
export function motionCornerPinParameters(effect: MotionEvaluatedEffect): Readonly<Record<string, number>> {
	if (effect.parameters.length !== 4 || new Set(effect.parameters.map((parameter) => parameter.id)).size !== 4 || effect.parameters.some((parameter) => !CORNERS.includes(parameter.id as typeof CORNERS[number]))) throw new TypeError('Motion corner-pin requires exactly four named corner vector parameters.');
	const quad = motionTrackingQuad(CORNERS.map((name) => effect.parameters.find((parameter) => parameter.id === name)!.value));
	return Object.freeze(Object.fromEntries(quad.flatMap(([x, y], index) => [[`x${index}`, x], [`y${index}`, y]])) as Record<string, number>);
}

export function planMotionCornerPin(width: number, height: number, origin: MotionVector2, params: Readonly<Record<string, number>>): MotionCornerPinPlan {
	motionSurfaceLength(width, height);
	if (origin.some((value) => !Number.isFinite(value))) throw new RangeError('Motion corner-pin source origin must be finite.');
	const quad = motionTrackingQuad(Array.from({ length: 4 }, (_, index) => [params[`x${index}`], params[`y${index}`]]));
	const x = Math.floor(Math.min(...quad.map((point) => point[0]))); const y = Math.floor(Math.min(...quad.map((point) => point[1])));
	const outputWidth = Math.ceil(Math.max(...quad.map((point) => point[0]))) - x; const outputHeight = Math.ceil(Math.max(...quad.map((point) => point[1]))) - y;
	motionSurfaceLength(outputWidth, outputHeight);
	// Input texel coordinates describe the current raster, including all preceding decorations.
	const inverse = motionTrackingHomography(quad, [[0, 0], [width, 0], [width, height], [0, height]]);
	return Object.freeze({ type: 'corner-pin', params, left: x - origin[0], top: y - origin[1], width: outputWidth, height: outputHeight, quad, inverse });
}

