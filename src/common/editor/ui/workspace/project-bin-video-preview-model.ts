/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveRuntimeClipProjection,
	type RuntimeClipProject,
	type RuntimePersistedClip,
} from '../../runtime-clip-projection.ts';
import {
	mapVideoTimelineFrameToSource,
	videoClipPlaybackRate,
	videoSourceCoordinateRate,
} from '../../video-source-time.ts';

export interface ProjectBinVideoPreviewModel {
	readonly durationFrames: number;
	readonly startSeconds: number;
	readonly endSeconds: number;
	readonly playbackRate: number;
}

/** Resolve the bin video's sequence extent and source clock before presenting it. */
export function projectBinVideoPreviewModel(
	project: RuntimeClipProject,
	clip: RuntimePersistedClip | null,
	source: Readonly<Record<string, unknown>> | null,
): Readonly<ProjectBinVideoPreviewModel> | null {
	if (!clip || clip.kind !== 'video' || !source || clip.sourceId !== source.id) return null;
	try {
		const resolved = resolveRuntimeClipProjection(project, clip);
		const sampleRate = Number(project.sampleRate);
		const sourceRate = videoSourceCoordinateRate(resolved, source);
		const options = { source, sourceSampleRate: sourceRate, projectSampleRate: sampleRate };
		const start = mapVideoTimelineFrameToSource(resolved, resolved.timelineStartFrame, options);
		const end = mapVideoTimelineFrameToSource(resolved, resolved.timelineEndFrame, options);
		if (start.sourceTimeSeconds === null || end.sourceTimeSeconds === null) return null;
		return Object.freeze({
			durationFrames: resolved.durationFrames,
			startSeconds: start.sourceTimeSeconds,
			endSeconds: end.sourceTimeSeconds,
			playbackRate: videoClipPlaybackRate(resolved, sampleRate, sourceRate, source),
		});
	} catch {
		// Exact timing may still be activating alongside the card's poster.
		return null;
	}
}
