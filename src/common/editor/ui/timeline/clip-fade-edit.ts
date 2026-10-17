/* SPDX-License-Identifier: AGPL-3.0-only */

import { fadeField, type ClipFadeEdge, type FadeClip } from './clip-fade-geometry.ts';

export function nearestClipEdge(clip: Pick<FadeClip, 'timelineStartFrame' | 'durationFrames'>, playheadFrame: number): 'left' | 'right' {
	return playheadFrame < clip.timelineStartFrame + clip.durationFrames / 2 ? 'left' : 'right';
}

/** Upstream's free fade window: the edited edge pushes the opposite fade away. */
export function clipFadeLengthChange(clip: FadeClip, edge: ClipFadeEdge, requested: number, sampleRate = 0): Readonly<{ fadeInFrames?: number; fadeOutFrames?: number }> {
	const value = Math.max(0, Math.min(clip.durationFrames, Math.round(requested)));
	const length = sampleRate > 0 && value < sampleRate * 0.02 ? 0 : value;
	const opposite = edge === 'in' ? 'out' : 'in';
	const other = clip[fadeField(opposite)] ?? 0;
	return { [fadeField(edge)]: length, ...(other + length > clip.durationFrames ? { [fadeField(opposite)]: clip.durationFrames - length } : {}) };
}

interface FadePointerInput {
	readonly clip: FadeClip;
	readonly edge: ClipFadeEdge;
	readonly rawDurationFrames: number;
	readonly sampleRate: number;
	readonly pixelsPerSecond: number;
	readonly playheadFrame: number;
	readonly gridEnabled: boolean;
	readonly gridFrame: number;
	readonly shiftKey: boolean;
	readonly boundaryFrames: readonly number[];
}

/** Fade lengths use the clip-drag grid, with Shift inversion and physical magnets. */
export function clipFadePointerEdit(input: FadePointerInput): ReturnType<typeof clipFadeLengthChange> {
	const { clip, edge, sampleRate, pixelsPerSecond } = input;
	const end = clip.timelineStartFrame + clip.durationFrames;
	const raw = edge === 'in' ? clip.timelineStartFrame + input.rawDurationFrames : end - input.rawDurationFrames;
	const reachableGrid = input.gridFrame >= clip.timelineStartFrame && input.gridFrame <= end;
	let boundary = input.gridEnabled !== input.shiftKey && reachableGrid ? input.gridFrame : raw;
	const tolerance = 6 * sampleRate / Math.max(1, pixelsPerSecond);
	let distance = tolerance;
	for (const candidate of input.gridEnabled || input.shiftKey ? [] : [input.playheadFrame, ...input.boundaryFrames]) {
		if (candidate < clip.timelineStartFrame || candidate > end) continue;
		const nextDistance = Math.abs(candidate - raw);
		if (nextDistance < distance) { distance = nextDistance; boundary = candidate; }
	}
	return clipFadeLengthChange(clip, edge, edge === 'in' ? boundary - clip.timelineStartFrame : end - boundary, sampleRate);
}
