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
	registeredVideoTimingIndex,
} from '../../video-source-time.ts';
import { createVideoRetimeFrameBinding } from '../../video-retime-frame-binding.ts';
import { bindVideoSourceTimingView, type VideoSourceTimingView } from '../../video-source-timing-view.ts';
import type { VideoTimingIndex } from '../../video-timing-asset.ts';
import { sequenceFrameAtSample } from '../../sequence-frame-navigation.ts';
import { resolveSequenceTimingView, type SequenceTimingProject } from '../../sequence-timing-model.ts';
import { videoFrameToSampleFrame } from '../../timeline-time.ts';

/** Image and generator leaves use the same authored sequence clock as video. */
export function projectBinVisualDurationFrames(project: SequenceTimingProject, clip: Readonly<Record<string, unknown>> | null): number | null {
	if (!clip || !['image', 'still', 'generator'].includes(String(clip.kind))) return null;
	const count = Number(clip.sequenceFrameCount);
	if (!Number.isSafeInteger(count) || count < 0) return null;
	const sequence = resolveSequenceTimingView(project);
	const sampleRate = Number(project.sampleRate);
	return videoFrameToSampleFrame(count, sequence.rate, sampleRate, 'point');
}

export interface ProjectBinVideoPreviewModel {
	readonly durationFrames: number;
	readonly startSeconds: number;
	readonly endSeconds: number;
	readonly playbackRate: number;
	readonly retimeIdentity?: string;
	readonly sourceTimeAtFrame?: (localFrame: number) => number;
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
		const retime = clip.retimeMap == null ? null : retimePreview(project, clip, source, sampleRate);
		const start = mapVideoTimelineFrameToSource(resolved, resolved.timelineStartFrame, options);
		const end = mapVideoTimelineFrameToSource(resolved, resolved.timelineEndFrame, options);
		if (start.sourceTimeSeconds === null || end.sourceTimeSeconds === null) return null;
		return Object.freeze({
			durationFrames: resolved.durationFrames,
			startSeconds: retime?.sourceTimeAtFrame(0) ?? start.sourceTimeSeconds,
			endSeconds: end.sourceTimeSeconds,
			playbackRate: videoClipPlaybackRate(resolved, sampleRate, sourceRate, source),
			...retime,
		});
	} catch {
		// Exact timing may still be activating alongside the card's poster.
		return null;
	}
}

function retimePreview(project: RuntimeClipProject, clip: RuntimePersistedClip, source: Readonly<Record<string, unknown>>, sampleRate: number) {
	const sourceId = String(source.id);
	const decision = source.timingDecision as Readonly<{ mode: unknown }>;
	let view: VideoSourceTimingView;
	if (decision.mode === 'conform-cfr-at-ingest') {
		view = { kind: 'cfr', rate: source.frameRate as Extract<VideoSourceTimingView, { kind: 'cfr' }>['rate'], frameCount: Number(source.sourceFrameCount) };
	} else {
		const index = registeredVideoTimingIndex(source);
		if (!index) throw new ReferenceError('Exact retimed bin video requires its active verified timing index.');
		view = { kind: 'vfr', index: index as VideoTimingIndex, reference: source.timingAsset as Extract<VideoSourceTimingView, { kind: 'vfr' }>['reference'] };
	}
	const timing = bindVideoSourceTimingView(new Map([[sourceId, view]]), source);
	const binding = createVideoRetimeFrameBinding(clip, timing);
	const sequence = resolveSequenceTimingView(project, String(clip.sequenceId));
	const origin = videoFrameToSampleFrame(Number(clip.sequenceStartFrame), sequence.rate, sampleRate, 'point');
	return {
		retimeIdentity: JSON.stringify([clip.id, clip.retimeMap, clip.sequenceStartFrame, clip.sequenceFrameCount, clip.sourceInFrame, clip.sourceFrameCount,
			sourceId, source.frameRate, source.timingAsset, source.contentSha256, sequence.rate, sampleRate]),
		sourceTimeAtFrame(localFrame: number): number {
			const cell = Math.min(binding.clip.outerFrameCount - 1, sequenceFrameAtSample(origin + Math.max(0, localFrame), sequence.rate, sampleRate) - binding.clip.sequenceStartFrame);
			const instant = binding.ownedFrameAt(cell).drawableSourceStartTime;
			return Number(instant.numerator) / Number(instant.denominator);
		},
	};
}
