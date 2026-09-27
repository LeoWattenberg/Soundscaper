/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ClipCrossfadeRanges } from '../../audio-clip-overlap.ts';
import { evaluateClipCrossfadeAt } from '../../audio-clip-transition-gain.ts';
import type { ClipFadeEdge } from '../../audio-clip-transition-gain.ts';

export interface CrossfadeVisualClip {
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly fadeInShape?: number;
	readonly fadeOutShape?: number;
}

export interface CrossfadeIntersection {
	readonly position: number;
	readonly gain: number;
}

interface CrossfadePointerPosition {
	readonly initialPosition: number;
	readonly initialGain: number;
	readonly startX: number;
	readonly startY: number;
	readonly clientX: number;
	readonly clientY: number;
	readonly width: number;
	readonly height: number;
}

interface CrossfadeShapeDragPosition extends CrossfadePointerPosition {
	readonly initialOutShape: number;
	readonly initialInShape: number;
}

export type CrossfadeKeyboardKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown'
	| 'PageUp' | 'PageDown' | 'Home' | 'End';

interface CrossfadeKeyboardPosition {
	readonly key: string;
	readonly shiftKey: boolean;
	readonly initialPosition: number;
	readonly initialGain: number;
	readonly width: number;
	readonly height: number;
}

const clampShape = (value: number): number => Math.max(0.15, Math.min(6, value));
const CROSSFADE_DRAG_THRESHOLD_PIXELS = 1;
const CROSSFADE_SHAPE_EPSILON = 1e-9;

function crossfadeGain(position: number, edge: ClipFadeEdge, shape: number): number {
	const progress = Math.max(0, Math.min(1, position));
	const base = edge === 'in'
		? Math.sin(progress * Math.PI / 2)
		: Math.cos(progress * Math.PI / 2);
	return base ** shape;
}

/** Locate the design-system intersection of two shaped equal-power ramps. */
export function crossfadeIntersection(outShape = 1, inShape = 1): CrossfadeIntersection {
	if (outShape === inShape) {
		return { position: 0.5, gain: Math.SQRT1_2 ** outShape };
	}
	let low = 0;
	let high = 1;
	for (let index = 0; index < 40; index += 1) {
		const middle = (low + high) / 2;
		if (crossfadeGain(middle, 'out', outShape) > crossfadeGain(middle, 'in', inShape)) low = middle;
		else high = middle;
	}
	const position = (low + high) / 2;
	return {
		position,
		gain: (crossfadeGain(position, 'out', outShape) + crossfadeGain(position, 'in', inShape)) / 2,
	};
}

export const MINIMUM_CROSSFADE_POSITION = crossfadeIntersection(6, 0.15).position;
export const MAXIMUM_CROSSFADE_POSITION = crossfadeIntersection(0.15, 6).position;

/** Solve both curve exponents from a drag of the shared intersection handle. */
export function crossfadeShapesAtPointer({
	initialPosition,
	initialGain,
	startX,
	startY,
	clientX,
	clientY,
	width,
	height,
}: CrossfadePointerPosition): Readonly<{ outShape: number; inShape: number }> {
	const position = Math.max(0.02, Math.min(0.98,
		initialPosition + (clientX - startX) / Math.max(1, width)));
	const gain = Math.max(0.05, Math.min(0.95,
		initialGain - (clientY - startY) / Math.max(1, height)));
	return {
		outShape: clampShape(Math.log(gain) / Math.log(Math.cos(position * Math.PI / 2))),
		inShape: clampShape(Math.log(gain) / Math.log(Math.sin(position * Math.PI / 2))),
	};
}

export function crossfadeShapesChanged(
	initialOutShape: number,
	initialInShape: number,
	shapes: Readonly<{ outShape: number; inShape: number }>,
): boolean {
	return Math.abs(shapes.outShape - initialOutShape) > CROSSFADE_SHAPE_EPSILON
		|| Math.abs(shapes.inShape - initialInShape) > CROSSFADE_SHAPE_EPSILON;
}

/** Ignore clicks and pointer tremor before solving, then reject numerical round-trip drift. */
export function crossfadeShapeDragResult(
	input: CrossfadeShapeDragPosition,
): Readonly<{ outShape: number; inShape: number }> | null {
	if (Math.hypot(input.clientX - input.startX, input.clientY - input.startY)
		< CROSSFADE_DRAG_THRESHOLD_PIXELS) return null;
	const shapes = crossfadeShapesAtPointer(input);
	return crossfadeShapesChanged(input.initialOutShape, input.initialInShape, shapes) ? shapes : null;
}

/** Move the horizontal slider through the same equal-power exponent solver as pointer edits. */
export function crossfadeShapesAtKey({
	key,
	shiftKey,
	initialPosition,
	initialGain,
	width,
	height,
}: CrossfadeKeyboardPosition): Readonly<{ outShape: number; inShape: number }> | null {
	if (key === 'Home') return { outShape: 6, inShape: 0.15 };
	if (key === 'End') return { outShape: 0.15, inShape: 6 };
	const direction = key === 'ArrowRight' || key === 'ArrowUp' || key === 'PageUp' ? 1
		: key === 'ArrowLeft' || key === 'ArrowDown' || key === 'PageDown' ? -1 : 0;
	if (!direction) return null;
	const positionStep = key === 'PageUp' || key === 'PageDown' ? 0.1 : shiftKey ? 0.001 : 0.01;
	return crossfadeShapesAtPointer({
		initialPosition,
		initialGain,
		startX: 0,
		startY: 0,
		clientX: direction * positionStep * Math.max(1, width),
		clientY: 0,
		width,
		height,
	});
}

/** Match the design-system path geometry to Soundscaper's actual clip gain. */
export function clipCrossfadeCurvePath(
	clip: CrossfadeVisualClip,
	ranges: ClipCrossfadeRanges,
	startFrame: number,
	endFrame: number,
	edge?: ClipFadeEdge,
): string {
	const localStart = startFrame - clip.timelineStartFrame;
	const localEnd = endFrame - clip.timelineStartFrame;
	const resolvedEdge = edge ?? (ranges.crossfadeInRanges.some(([start, end]) => (
		start === localStart && end === localEnd
	)) ? 'in' : 'out');
	const crossfadeRanges = resolvedEdge === 'in' ? ranges.crossfadeInRanges : ranges.crossfadeOutRanges;
	const shape = resolvedEdge === 'in' ? clip.fadeInShape : clip.fadeOutShape;
	const samples = 64;
	const points: string[] = [];
	for (let index = 0; index <= samples; index += 1) {
		const progress = index / samples;
		const frame = startFrame + (endFrame - startFrame) * progress;
		const gain = evaluateClipCrossfadeAt(
			frame - clip.timelineStartFrame, crossfadeRanges, resolvedEdge, shape ?? 1,
		);
		points.push(`${(progress * 100).toFixed(2)},${((1 - gain) * 100).toFixed(2)}`);
	}
	return `M ${points.join(' L ')}`;
}
