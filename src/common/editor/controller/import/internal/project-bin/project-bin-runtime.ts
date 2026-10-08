/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveRuntimeClipProjection } from '../../../../runtime-clip-projection.ts';
import { scaleSampleFrame } from '../../../../timeline-time.ts';
import { normalizeAudioWarpMap } from '../../../../audio-warp-domain.ts';
import { buildAudioWarpRuntimeSegments, type AudioWarpRuntimeClip, type AudioWarpRuntimeProject } from '../../../../audio-warp-runtime.ts';
import { isNativeProjectBinVideo, projectBinVideoReplacementRange } from '../../../../project-bin-video-replacement.ts';
import type { ProjectBinClip, ProjectBinProject, ProjectBinSource } from '../../project-bin-types.ts';

/** Preview geometry is sample anchored even when the authored bin clip follows beats. */
export function resolveProjectBinAudioPreviewClip(project: ProjectBinProject, clip: ProjectBinClip) {
	const resolved = resolveRuntimeClipProjection(project, clip);
	let warpMap = resolved.warpMap;
	if (warpMap != null && resolved.anchor === 'musical') {
		// The bin auditions at sample zero. Preserve the original beat/tempo
		// traversal as a sample-domain map before retiring its timeline anchor.
		const segments = buildAudioWarpRuntimeSegments(project as AudioWarpRuntimeProject,
			resolved as AudioWarpRuntimeClip, {
				startFrame: resolved.timelineStartFrame, endFrame: resolved.timelineEndFrame,
				sourceSampleRate: project.sampleRate,
			});
		const last = segments.at(-1)!;
		warpMap = normalizeAudioWarpMap({ feature: 'audio-warp', points: [
			...segments.map(segment => ({ outer: segment.timelineStartFrame - resolved.timelineStartFrame,
				source: segment.sourceStartFrame, mode: 'forward' })),
			{ outer: resolved.durationFrames, source: last.sourceEndFrame, mode: 'forward' },
		] });
	}
	return { ...resolved, warpMap, anchor: 'sample' as const, timelineStartFrame: 0 };
}

export function projectBinReplacementShortensClip(
	project: ProjectBinProject, clip: ProjectBinClip, oldSource: ProjectBinSource, newSource: ProjectBinSource,
): boolean {
	if (isNativeProjectBinVideo(clip)) return projectBinVideoReplacementRange(project, clip, oldSource, newSource)?.shortens ?? true;
	const resolved = resolveRuntimeClipProjection(project, clip);
	const count = newSource.sampleFrameCount ?? newSource.frameCount;
	if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1) {
		throw new TypeError('A replacement source requires a finite sample extent.');
	}
	const newRate = Math.max(1, newSource.sampleRate || project.sampleRate);
	const oldRate = Math.max(1, oldSource.sampleRate || project.sampleRate);
	const start = scaleSampleFrame(resolved.sourceStartFrame, oldRate, newRate, 'point');
	const duration = scaleSampleFrame(resolved.sourceDurationFrames, oldRate, newRate, 'point');
	return start + duration > count;
}
