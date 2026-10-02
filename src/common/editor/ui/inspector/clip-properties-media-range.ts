/* SPDX-License-Identifier: AGPL-3.0-only */

interface ClipRange {
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
	readonly reversed?: boolean;
}

/** Convert the media fields without changing the clip's project placement. */
export function clipPropertiesMediaRange(clip: ClipRange, sourceFrameCount: number,
	field: 'sourceInFrame' | 'durationFrame', value: number) {
	const oldEnd = clip.sourceStartFrame + clip.sourceDurationFrames;
	const requestedSpan = field === 'durationFrame'
		? Math.max(1, Math.round(value * clip.sourceDurationFrames / clip.durationFrames))
		: clip.sourceDurationFrames;
	const sourceStartFrame = field === 'sourceInFrame'
		? Math.min(value, sourceFrameCount - 1)
		: clip.reversed ? Math.max(0, oldEnd - requestedSpan) : clip.sourceStartFrame;
	const sourceDurationFrames = field === 'durationFrame' && clip.reversed
		? oldEnd - sourceStartFrame
		: Math.min(requestedSpan, sourceFrameCount - sourceStartFrame);
	return { sourceStartFrame, sourceDurationFrames,
		durationFrames: Math.max(1, Math.round(clip.durationFrames * sourceDurationFrames / clip.sourceDurationFrames)) };
}
