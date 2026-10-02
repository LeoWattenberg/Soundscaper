/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateAudioWarpMap, evaluateAudioWarpMapAtSource, normalizeAudioWarpMap, type AudioWarpMap } from './audio-warp-domain.ts';
import { audioWarpOuterAtTimelineFrame, isMusicalAudioWarpClip, type AudioWarpAuthorityRuntimeClip, type AudioWarpAuthorityRuntimeProject } from './audio-warp-runtime-authority.ts';
import { addRationals, beatToSampleFrame } from './timeline-time.ts';

export type ClipSourceTimingClip = AudioWarpAuthorityRuntimeClip;
export type ClipSourceTimingProject = AudioWarpAuthorityRuntimeProject;
export interface ClipSourceTimingSource { readonly sampleRate: number; readonly frameCount: number }
export interface ClipSourceDisplayRange { readonly startFrame: number; readonly endFrame: number; readonly totalFrames: number }

/** Full media, with the active clip's output duration replacing its original source span. */
export function clipSourceDisplayRange(clip: ClipSourceTimingClip, source: ClipSourceTimingSource, sampleRate: number): ClipSourceDisplayRange {
	const ratio = sampleRate / source.sampleRate;
	const startFrame = Math.round(clip.sourceStartFrame * ratio);
	const endFrame = startFrame + clip.durationFrames;
	return Object.freeze({ startFrame, endFrame, totalFrames: endFrame + Math.round(Math.max(0, source.frameCount - clip.sourceStartFrame - clip.sourceDurationFrames) * ratio) });
}

export function clipSourceFrameToDisplay(project: ClipSourceTimingProject, clip: ClipSourceTimingClip, source: ClipSourceTimingSource, sourceFrame: number): number {
	const range = clipSourceDisplayRange(clip, source, project.sampleRate);
	const frame = Math.max(0, Math.min(source.frameCount, sourceFrame));
	const end = clip.sourceStartFrame + clip.sourceDurationFrames;
	if (frame < clip.sourceStartFrame) return frame * project.sampleRate / source.sampleRate;
	if (frame > end) return range.endFrame + (frame - end) * project.sampleRate / source.sampleRate;
	if (clip.warpMap != null) {
		const outer = evaluateAudioWarpMapAtSource(clip.warpMap, Math.round(frame));
		const offset = isMusicalAudioWarpClip(clip)
			? beatToSampleFrame(addRationals(clip.musicalStartBeat!, outer), project.tempoMap, project.sampleRate) - clip.timelineStartFrame
			: outer.num / outer.den;
		return range.startFrame + offset;
	}
	const progress = (frame - clip.sourceStartFrame) / clip.sourceDurationFrames;
	return range.startFrame + (clip.reversed ? 1 - progress : progress) * clip.durationFrames;
}

export function clipDisplayFrameToSource(project: ClipSourceTimingProject, clip: ClipSourceTimingClip, source: ClipSourceTimingSource, displayFrame: number): number {
	const range = clipSourceDisplayRange(clip, source, project.sampleRate);
	const frame = Math.max(0, Math.min(range.totalFrames, displayFrame));
	if (frame < range.startFrame) return frame * source.sampleRate / project.sampleRate;
	if (frame > range.endFrame) return clip.sourceStartFrame + clip.sourceDurationFrames + (frame - range.endFrame) * source.sampleRate / project.sampleRate;
	if (clip.warpMap != null) {
		const outer = audioWarpOuterAtTimelineFrame(project, clip, clip.timelineStartFrame + Math.round(frame - range.startFrame));
		const mapped = evaluateAudioWarpMap(clip.warpMap, outer);
		return mapped.num / mapped.den;
	}
	const progress = (frame - range.startFrame) / clip.durationFrames;
	return clip.sourceStartFrame + (clip.reversed ? 1 - progress : progress) * clip.sourceDurationFrames;
}

/** Rebase musical maps to samples while preserving every tempo change within the clip. */
export function clipSourcePreviewWarpMap(project: ClipSourceTimingProject, clip: ClipSourceTimingClip, source: ClipSourceTimingSource): Readonly<AudioWarpMap> | null {
	if (clip.warpMap == null) return null;
	const map = normalizeAudioWarpMap(clip.warpMap);
	if (!isMusicalAudioWarpClip(clip)) return map;
	const { startFrame } = clipSourceDisplayRange(clip, source, project.sampleRate);
	const points = map.points.map((point) => ({ ...point, outer: { num: Math.round(clipSourceFrameToDisplay(project, clip, source, point.source.num / point.source.den) - startFrame), den: 1 } }));
	for (const event of project.tempoMap.events) {
		const frame = beatToSampleFrame(event.beat, project.tempoMap, project.sampleRate) - clip.timelineStartFrame;
		if (frame <= 0 || frame >= clip.durationFrames || points.some((point) => point.outer.num === frame)) continue;
		points.push({ outer: { num: frame, den: 1 }, source: evaluateAudioWarpMap(map, audioWarpOuterAtTimelineFrame(project, clip, clip.timelineStartFrame + frame)), mode: 'forward' });
	}
	return normalizeAudioWarpMap({ feature: 'audio-warp', points: points.sort((left, right) => left.outer.num - right.outer.num) });
}
