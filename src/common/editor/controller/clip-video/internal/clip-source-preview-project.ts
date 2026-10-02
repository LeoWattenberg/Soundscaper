/* SPDX-License-Identifier: AGPL-3.0-only */

import { clipSourceDisplayRange, clipSourcePreviewWarpMap, type ClipSourceTimingClip, type ClipSourceTimingProject, type ClipSourceTimingSource } from '../../../clip-source-timing.ts';
import { createAudioPreviewProject } from '../../../engine/audio-preview-project.ts';
import type { EngineProject } from '../../../engine/types.ts';

export interface ClipSourcePreviewClip extends ClipSourceTimingClip, Readonly<Record<string, unknown>> { readonly id: string; readonly sourceId: string }
export interface ClipSourcePreviewSource extends ClipSourceTimingSource, Readonly<Record<string, unknown>> { readonly id: string }
export interface ClipSourcePreviewProject extends ClipSourceTimingProject {
	readonly id: string;
	readonly clips: readonly ClipSourcePreviewClip[];
	readonly sources: readonly ClipSourcePreviewSource[];
}

export function sourcePreviewTarget(project: ClipSourcePreviewProject, clipId: string) {
	const clip = project.clips.find((candidate) => candidate.id === clipId);
	const source = clip && project.sources.find((candidate) => candidate.id === clip.sourceId);
	if (!clip || clip.kind !== 'audio' || !source) throw new RangeError('The source editor requires an available audio clip.');
	return { clip, source, range: clipSourceDisplayRange(clip, source, project.sampleRate) };
}

/** Audition all media while preserving the active clip's non-destructive processing. */
export function createClipSourcePreviewProject(project: ClipSourcePreviewProject, clipId: string): EngineProject {
	const { clip, source, range } = sourcePreviewTarget(project, clipId);
	const clips: Readonly<object>[] = [];
	const raw = { sourceId: source.id, kind: 'audio', anchor: 'sample', gain: 1, pitchCents: 0, speedRatio: 1, reversed: false, inverted: false, fadeInFrames: 0, fadeOutFrames: 0, envelope: [], warpMap: null };
	if (range.startFrame > 0) clips.push({ ...raw, id: `${clip.id}-source-before`, timelineStartFrame: 0, durationFrames: range.startFrame, sourceStartFrame: 0, sourceDurationFrames: clip.sourceStartFrame });
	clips.push({
		...clip, anchor: 'sample', musicalStartBeat: null, musicalDurationBeats: null, musicalExtent: 'fixedSamples',
		timelineStartFrame: range.startFrame, groupId: null, avLinkId: null, binItemId: null,
		warpMap: clipSourcePreviewWarpMap(project, clip, source),
	});
	if (range.endFrame < range.totalFrames) clips.push({
		...raw, id: `${clip.id}-source-after`, timelineStartFrame: range.endFrame, durationFrames: range.totalFrames - range.endFrame,
		sourceStartFrame: clip.sourceStartFrame + clip.sourceDurationFrames, sourceDurationFrames: source.frameCount - clip.sourceStartFrame - clip.sourceDurationFrames,
	});
	return {
		...createAudioPreviewProject({
			title: 'Clip source preview', sampleRate: project.sampleRate, sources: [source], clips,
			tracks: [{ id: 'clip-source-preview-track', type: 'audio', name: 'Clip source', clipIds: clips.map((value) => (value as { id: string }).id), armed: false }],
		}),
		tempoMap: project.tempoMap,
	};
}
