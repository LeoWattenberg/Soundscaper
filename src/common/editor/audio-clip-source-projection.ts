/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClipLoop } from './audio-clip-loop.ts';

export interface UnwarpedClipSourceProjection {
	readonly durationFrames: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly reversed: boolean;
	readonly opaqueExtensions?: unknown;
}

export interface ProjectedClipSourceRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

/**
 * Project clip-local timeline boundaries into an ordered source range.
 * Callers retain ownership of admission, clamping and rounding policy.
 */
export function projectUnwarpedClipSourceRange(
	clip: UnwarpedClipSourceProjection,
	localStartFrame: number,
	localEndFrame: number,
): ProjectedClipSourceRange {
	const loop = readClipLoop(clip);
	if (loop) {
		const offset = (localStartFrame + loop.offsetFrames) % loop.periodFrames;
		const span = localEndFrame - localStartFrame;
		if (offset + span > loop.periodFrames) return { startFrame: clip.sourceStartFrame, endFrame: clip.sourceStartFrame + clip.sourceDurationFrames };
		localStartFrame = offset;
		localEndFrame = offset + span;
	}
	const sourceFramesPerTimelineFrame = clip.sourceDurationFrames / (loop?.periodFrames ?? clip.durationFrames);
	const relativeStartFrame = localStartFrame * sourceFramesPerTimelineFrame;
	const relativeEndFrame = localEndFrame * sourceFramesPerTimelineFrame;
	const projectedStartFrame = clip.sourceStartFrame + (clip.reversed
		? clip.sourceDurationFrames - relativeStartFrame
		: relativeStartFrame);
	const projectedEndFrame = clip.sourceStartFrame + (clip.reversed
		? clip.sourceDurationFrames - relativeEndFrame
		: relativeEndFrame);
	return {
		startFrame: Math.min(projectedStartFrame, projectedEndFrame),
		endFrame: Math.max(projectedStartFrame, projectedEndFrame),
	};
}
