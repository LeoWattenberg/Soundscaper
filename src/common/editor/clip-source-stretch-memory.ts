/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateAudioWarpMapAtSource, normalizeAudioWarpMap, type AudioWarpMap } from './audio-warp-domain.ts';
import { clipSourceDisplayRange, clipSourcePreviewWarpMap, type ClipSourceTimingClip, type ClipSourceTimingProject, type ClipSourceTimingSource } from './clip-source-timing.ts';
import { addRationals, subtractRationals, type Rational } from './timeline-time.ts';

export const CLIP_SOURCE_STRETCH_EXTENSION = 'org.soundscaper.clipSourceStretch';
interface StretchClip extends ClipSourceTimingClip { readonly sourceId?: unknown; readonly opaqueExtensions?: unknown }
export interface ClipSourceStretchMemory { readonly sourceId: unknown; readonly sourceFrameCount: number; readonly map: Readonly<AudioWarpMap> }

/** Keep hidden source anchors in the clip's existing serializable extension envelope. */
export function clipSourceStretchMemory(project: ClipSourceTimingProject, clip: StretchClip, source: ClipSourceTimingSource) {
	const extension = extensionsOf(clip)[CLIP_SOURCE_STRETCH_EXTENSION] as ClipSourceStretchMemory | undefined;
	const current = clipSourcePreviewWarpMap(project, clip, source);
	if (!current) return null;
	const previous = extension && extension.sourceId === clip.sourceId && extension.sourceFrameCount === source.frameCount
		? normalizeAudioWarpMap(extension.map) : null;
	const range = clipSourceDisplayRange(clip, source, project.sampleRate);
	const points = current.points.map((point) => ({ ...point, outer: addRationals(point.outer, range.startFrame) }));
	if (clip.sourceStartFrame > 0) points.unshift({ outer: { num: 0, den: 1 }, source: { num: 0, den: 1 }, mode: 'forward' });
	if (clip.sourceStartFrame + clip.sourceDurationFrames < source.frameCount) points.push({ outer: { num: range.totalFrames, den: 1 }, source: { num: source.frameCount, den: 1 }, mode: 'forward' });
	if (!previous) return normalizeAudioWarpMap({ feature: 'audio-warp', points });
	const start = clip.sourceStartFrame;
	const end = start + clip.sourceDurationFrames;
	const oldStart = evaluateAudioWarpMapAtSource(previous, start);
	const oldEnd = evaluateAudioWarpMapAtSource(previous, end);
	const shift = subtractRationals(addRationals(oldStart, clip.durationFrames), oldEnd);
	return normalizeAudioWarpMap({ feature: 'audio-warp', points: [
		...previous.points.filter((point) => numberOf(point.source) < start),
		...current.points.map((point) => ({ ...point, outer: addRationals(oldStart, point.outer) })),
		...previous.points.filter((point) => numberOf(point.source) > end).map((point) => ({ ...point, outer: addRationals(point.outer, shift) })),
	] });
}

export function clipSourceStretchExtensions(clip: StretchClip, source: ClipSourceTimingSource, map: Readonly<AudioWarpMap>) {
	return { ...extensionsOf(clip), [CLIP_SOURCE_STRETCH_EXTENSION]: { sourceId: clip.sourceId ?? null, sourceFrameCount: source.frameCount, map } };
}

function extensionsOf(clip: StretchClip): Readonly<Record<string, unknown>> {
	return clip.opaqueExtensions && typeof clip.opaqueExtensions === 'object' && !Array.isArray(clip.opaqueExtensions)
		? clip.opaqueExtensions as Readonly<Record<string, unknown>> : {};
}
function numberOf(value: Rational): number { return value.num / value.den; }
