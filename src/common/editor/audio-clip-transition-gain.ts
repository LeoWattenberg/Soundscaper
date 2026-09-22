/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FrameRange } from './audio-clip-overlap.ts';

export type ClipFadeEdge = 'in' | 'out';

export interface ClipTransitionGainOptions {
	readonly fadeInFrames: number;
	readonly fadeOutFrames: number;
	readonly crossfadeInRanges: readonly FrameRange[];
	readonly crossfadeOutRanges: readonly FrameRange[];
}

/** Evaluate one authored linear clip fade after its owning adapter has bounded it. */
export function evaluateLinearClipFadeAt(
	frame: number,
	durationFrames: number,
	fadeFrames: number,
	edge: ClipFadeEdge,
): number {
	if (!(fadeFrames > 0)) return 1;
	if (edge === 'in') return frame < fadeFrames ? Math.max(0, frame / fadeFrames) : 1;
	return frame > durationFrames - fadeFrames
		? Math.max(0, (durationFrames - frame) / fadeFrames)
		: 1;
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
): number {
	return Math.min(
		evaluateLinearClipFadeAt(frame, durationFrames, fadeFrames, edge),
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
	) * evaluateClipEdgeGainAt(
		frame,
		durationFrames,
		options.fadeOutFrames,
		options.crossfadeOutRanges,
		'out',
	);
}
