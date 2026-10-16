/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateAudioWarpMap, evaluateAudioWarpMapAtSource } from '../../audio-warp-domain.ts';
import { clipSourceStretchMemory } from '../../clip-source-stretch-memory.ts';
import type { ClipSourceTimingClip, ClipSourceTimingProject, ClipSourceTimingSource } from '../../clip-source-timing.ts';
import { addRationals, subtractRationals } from '../../timeline-time.ts';

interface MediaAuthority {
	readonly project: ClipSourceTimingProject;
	readonly source: ClipSourceTimingSource;
}

/** Convert the media fields without changing the clip's project placement. */
export function clipPropertiesMediaRange(clip: ClipSourceTimingClip, sourceFrameCount: number,
	field: 'sourceInFrame' | 'durationFrame', value: number, authority?: MediaAuthority) {
	if (clip.warpMap != null && authority) {
		const map = clipSourceStretchMemory(authority.project, clip, authority.source)!;
		const originalStart = evaluateAudioWarpMapAtSource(map, clip.sourceStartFrame);
		const sourceStartFrame = field === 'sourceInFrame'
			? Math.min(value, sourceFrameCount - 1) : clip.sourceStartFrame;
		const requestedEnd = field === 'durationFrame'
			? evaluateAudioWarpMap(map, addRationals(originalStart, Math.max(1, value)))
			: { num: sourceStartFrame + clip.sourceDurationFrames, den: 1 };
		const sourceEndFrame = Math.max(sourceStartFrame + 1,
			Math.min(sourceFrameCount, Math.round(requestedEnd.num / requestedEnd.den)));
		const duration = subtractRationals(evaluateAudioWarpMapAtSource(map, sourceEndFrame),
			evaluateAudioWarpMapAtSource(map, sourceStartFrame));
		return { sourceStartFrame, sourceDurationFrames: sourceEndFrame - sourceStartFrame,
			durationFrames: Math.max(1, Math.round(duration.num / duration.den)) };
	}
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
