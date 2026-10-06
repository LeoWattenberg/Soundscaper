/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateAudioWarpMapAtSource } from './audio-warp-domain.ts';
import { createAudioWarpRuntimeEvaluator } from './audio-warp-runtime.ts';
import { resolveAudioWarpEditFrame } from './audio-warp-clip-edit.ts';
import type { AudioWarpAuthorityProject } from './audio-warp-clip-authority.ts';
import type { RuntimeClipProject } from './runtime-clip-projection.ts';
import { addRationals, beatToSampleFrame } from './timeline-time.ts';
import type { AudioWarpRuntimeClip } from './audio-warp-runtime.ts';
import type { ClipSilenceRegion, ClipSilenceScanBounds, ClipSilenceScanClip } from './clip-silence-regions.ts';

/** Scan immutable source samples, then carry the result back through the authored map. */
export function createClipSilenceWarpProjection(clip: ClipSilenceScanClip,
	bounds: ClipSilenceScanBounds | null, project: RuntimeClipProject | null) {
	if (!project || typeof project.sampleRate !== 'number' || !project.tempoMap
		|| !Array.isArray(project.clips) || !Array.isArray(project.tracks)) {
		throw new TypeError('Warped silence detection requires the clip project.');
	}
	const authority = project as AudioWarpAuthorityProject;
	const normalized: AudioWarpRuntimeClip = { ...clip, kind: 'audio',
		sourceDurationFrames: clip.sourceDurationFrames ?? clip.durationFrames };
	const evaluator = createAudioWarpRuntimeEvaluator(authority, normalized);
	const from = Math.max(clip.timelineStartFrame, bounds?.startFrame ?? clip.timelineStartFrame);
	const until = Math.min(clip.timelineStartFrame + clip.durationFrames,
		bounds?.endFrame ?? clip.timelineStartFrame + clip.durationFrames);
	const sourceClip = { ...clip, warpMap: null, loop: null, reversed: false,
		timelineStartFrame: clip.sourceStartFrame, durationFrames: normalized.sourceDurationFrames,
		sourceDurationFrames: normalized.sourceDurationFrames };
	const sourceBounds = until > from ? {
		startFrame: sourceNumber(from), endFrame: sourceNumber(until),
	} : { startFrame: clip.sourceStartFrame, endFrame: clip.sourceStartFrame };
	return { clip: sourceClip, bounds: sourceBounds, toTimeline };

	function sourceNumber(frame: number): number {
		const value = evaluator.sourceAtTimelineFrame(frame);
		return Math.round(value.num / value.den);
	}
	function timelineNumber(source: number): number | null {
		const outer = evaluateAudioWarpMapAtSource(evaluator.map, source);
		const frame = normalized.anchor === 'musical'
			? beatToSampleFrame(addRationals(normalized.musicalStartBeat!, outer), authority.tempoMap, authority.sampleRate)
			: Math.round(clip.timelineStartFrame + outer.num / outer.den);
		return resolveAudioWarpEditFrame(authority, { ...normalized }, frame);
	}
	function toTimeline(regions: readonly ClipSilenceRegion[]): readonly ClipSilenceRegion[] {
		const result: ClipSilenceRegion[] = [];
		for (const [sourceStart, sourceEnd] of regions) {
			const start = timelineNumber(sourceStart);
			const end = timelineNumber(sourceEnd);
			if (start !== null && end !== null && start > clip.timelineStartFrame
				&& end < clip.timelineStartFrame + clip.durationFrames && end > start) {
				result.push(Object.freeze([start, end]));
			}
		}
		return Object.freeze(result);
	}
}
