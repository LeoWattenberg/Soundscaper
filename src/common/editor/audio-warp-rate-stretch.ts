/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAudioWarpMap } from './audio-warp-domain.ts';
import { audioWarpOuterAtTimelineFrame, isMusicalAudioWarpClip, type AudioWarpAuthorityRuntimeClip, type AudioWarpAuthorityRuntimeProject } from './audio-warp-runtime-authority.ts';
import { clipSourcePreviewWarpMap, type ClipSourceTimingSource } from './clip-source-timing.ts';
import { sampleFrameToBeat } from './timeline-tempo-inverse.ts';

/** Stretch elapsed output time while every authored marker retains its source sample. */
export function stretchAudioWarpClipRate(
	project: AudioWarpAuthorityRuntimeProject,
	clip: AudioWarpAuthorityRuntimeClip,
	source: ClipSourceTimingSource,
	timelineStartFrame: number,
	durationFrames: number,
) {
	const previous = clipSourcePreviewWarpMap(project, clip, source);
	if (!previous) return null;
	const next = { ...clip, timelineStartFrame, durationFrames,
		...(isMusicalAudioWarpClip(clip) && timelineStartFrame !== clip.timelineStartFrame
			? { musicalStartBeat: sampleFrameToBeat(timelineStartFrame, project.tempoMap, project.sampleRate) } : {}),
	};
	const points = previous.points.map((point, index) => ({ ...point,
		outer: index === 0 ? { num: 0, den: 1 } : audioWarpOuterAtTimelineFrame(project, next,
			timelineStartFrame + (index === previous.points.length - 1 ? durationFrames
				: Math.round(point.outer.num / point.outer.den * durationFrames / clip.durationFrames))),
	}));
	return { sourceStartFrame: clip.sourceStartFrame, sourceDurationFrames: clip.sourceDurationFrames,
		warpMap: normalizeAudioWarpMap({ feature: 'audio-warp', points }),
	};
}
