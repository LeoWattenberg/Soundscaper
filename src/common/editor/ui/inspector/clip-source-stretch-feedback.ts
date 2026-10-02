/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeAudioWarpMap } from '../../audio-warp-domain.ts';
import { clipSourceFrameToDisplay, type ClipSourceTimingProject, type ClipSourceTimingClip, type ClipSourceTimingSource } from '../../clip-source-timing.ts';

/** Adjacent speeds are source seconds per output second, independent of sample rate. */
export function clipSourceStretchFeedback(project: ClipSourceTimingProject, clip: ClipSourceTimingClip, source: ClipSourceTimingSource, pointIndex: number, requestedFrame?: number) {
	if (!clip.warpMap) return null;
	const points = normalizeAudioWarpMap(clip.warpMap).points;
	const before = points[pointIndex - 1], point = points[pointIndex], after = points[pointIndex + 1];
	if (!before || !point || !after) return null;
	const beforeSample = before.source.num / before.source.den;
	const sourceFrame = point.source.num / point.source.den;
	const afterSample = after.source.num / after.source.den;
	const beforeFrame = clipSourceFrameToDisplay(project, clip, source, beforeSample);
	const afterFrame = clipSourceFrameToDisplay(project, clip, source, afterSample);
	const firstFrame = Math.floor(beforeFrame) + 1, lastFrame = Math.ceil(afterFrame) - 1;
	const canMove = firstFrame <= lastFrame && (requestedFrame === undefined || Number.isFinite(requestedFrame));
	// Stored points can be fractional after rate changes. Focus must not quantize
	// them, and an interval narrower than one sample may have no legal UI move.
	const displayFrame = requestedFrame !== undefined && canMove
		? Math.max(firstFrame, Math.min(lastFrame, Math.round(requestedFrame)))
		: clipSourceFrameToDisplay(project, clip, source, sourceFrame);
	return { sourceFrame, displayFrame, canMove,
		beforeSpeed: (sourceFrame - beforeSample) / source.sampleRate * project.sampleRate / (displayFrame - beforeFrame),
		afterSpeed: (afterSample - sourceFrame) / source.sampleRate * project.sampleRate / (afterFrame - displayFrame),
	};
}

export function formatSourceStretchSpeed(ratio: number): string {
	return `${ratio.toFixed(2)}× (${Number((ratio * 100).toFixed(1))}%)`;
}
