/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameRange } from './audio-clip-overlap.ts';

export type ClipFadeEdge = 'in' | 'out';

export interface ClipTransitionGainOptions {
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly fadeInShape?: number;
	readonly fadeOutShape?: number;
	readonly crossfadeInRanges: readonly FrameRange[];
	readonly crossfadeOutRanges: readonly FrameRange[];
}

interface AuthoredFadeFields {
	readonly fadeInFrames?: number;
	readonly fadeOutFrames?: number;
	readonly fadeInShape?: number;
	readonly fadeOutShape?: number;
}

/** Only a newly added fade gets the equal-power default; old unshaped fades stay linear. */
export function shapesForNewClipFades(
	before: AuthoredFadeFields,
	changes: AuthoredFadeFields,
): Readonly<{ fadeInShape?: 1; fadeOutShape?: 1 }> {
	return {
		...((before.fadeInFrames ?? 0) === 0 && (changes.fadeInFrames ?? 0) > 0
			&& before.fadeInShape === undefined && changes.fadeInShape === undefined ? { fadeInShape: 1 as const } : {}),
		...((before.fadeOutFrames ?? 0) === 0 && (changes.fadeOutFrames ?? 0) > 0
			&& before.fadeOutShape === undefined && changes.fadeOutShape === undefined ? { fadeOutShape: 1 as const } : {}),
	};
}

/** An absent shape retains the linear gain of projects saved before shape handles. */
export function evaluateClipFadeAt(
	frame: number,
	durationFrames: number,
	fadeFrames: number,
	edge: ClipFadeEdge,
	shape?: number,
): number {
	if (!(fadeFrames > 0)) return 1;
	const progress = edge === 'in'
		? Math.max(0, Math.min(1, frame / fadeFrames))
		: Math.max(0, Math.min(1, (durationFrames - frame) / fadeFrames));
	return shape === undefined ? progress : Math.sin(progress * Math.PI / 2) ** shape;
}

/** Evaluate all automatic crossfades on one edge; the quietest active overlap wins. */
export function evaluateClipCrossfadeAt(
	frame: number,
	ranges: readonly FrameRange[],
	edge: ClipFadeEdge,
): number {
	let gain = 1;
	for (const [start, end] of ranges) {
		if (frame < start || frame > end) continue;
		const progress = end > start ? (frame - start) / (end - start) : 1;
		const value = edge === 'in' ? progress : 1 - progress;
		gain = Math.min(gain, Math.max(0, Math.min(1, value)));
	}
	return gain;
}

/** Evaluate the authored and automatic fades that share one clip edge. */
export function evaluateClipEdgeGainAt(
	frame: number,
	durationFrames: number,
	fadeFrames: number,
	crossfadeRanges: readonly FrameRange[],
	edge: ClipFadeEdge,
	shape?: number,
): number {
	return Math.min(
		evaluateClipFadeAt(frame, durationFrames, fadeFrames, edge, shape),
		evaluateClipCrossfadeAt(frame, crossfadeRanges, edge),
	);
}

/** Evaluate both clip edges at one local frame without choosing a sampling strategy. */
export function evaluateClipTransitionGainAt(
	frame: number,
	durationFrames: number,
	options: ClipTransitionGainOptions,
): number {
	return evaluateClipEdgeGainAt(
		frame,
		durationFrames,
		options.fadeInFrames,
		options.crossfadeInRanges,
		'in',
		options.fadeInShape,
	) * evaluateClipEdgeGainAt(
		frame,
		durationFrames,
		options.fadeOutFrames,
		options.crossfadeOutRanges,
		'out',
		options.fadeOutShape,
	);
}
