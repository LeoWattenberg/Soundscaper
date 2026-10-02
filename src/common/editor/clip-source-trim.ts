/* SPDX-License-Identifier: AGPL-3.0-only */

import { clipSourceStretchMemory, clipSourceStretchExtensions } from './clip-source-stretch-memory.ts';
import { normalizeAudioWarpMap, evaluateAudioWarpMapAtSource, type AudioWarpMap } from './audio-warp-domain.ts';
import { audioWarpOuterAtTimelineFrame } from './audio-warp-runtime-authority.ts';
import { type ClipSourceTimingClip, type ClipSourceTimingProject, type ClipSourceTimingSource } from './clip-source-timing.ts';

export interface ClipSourceTrim {
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly durationFrames: number;
}

/** Source edits retain the project anchor and every surviving marker's exact sample. */
export function clipSourceTrimFields(project: ClipSourceTimingProject, clip: ClipSourceTimingClip, source: ClipSourceTimingSource, changes: ClipSourceTrim): ClipSourceTrim & Readonly<{ warpMap?: Readonly<AudioWarpMap>; opaqueExtensions?: Readonly<Record<string, unknown>> }> {
	if (clip.kind !== 'audio') throw new RangeError('Source range trimming requires an audio clip.');
	for (const [field, value] of Object.entries(changes)) {
		if (!Number.isSafeInteger(value) || value < (field === 'sourceStartFrame' ? 0 : 1)) throw new RangeError('Clip source range requires whole, positive sample extents.');
	}
	const end = changes.sourceStartFrame + changes.sourceDurationFrames;
	if (end > source.frameCount) throw new RangeError('Clip source range exceeds the media duration.');
	if (clip.warpMap == null) return { ...changes };
	const map = clipSourceStretchMemory(project, clip, source)!;
	const displayAtSource = (frame: number) => {
		const outer = evaluateAudioWarpMapAtSource(map, frame);
		return outer.num / outer.den;
	};
	const displayStart = displayAtSource(changes.sourceStartFrame);
	const displayEnd = displayAtSource(end);
	const sourcePoints = [
		{ source: { num: changes.sourceStartFrame, den: 1 } },
		...map.points.filter((point) => point.source.num / point.source.den > changes.sourceStartFrame && point.source.num / point.source.den < end),
		{ source: { num: end, den: 1 } },
	];
	const points = sourcePoints.map((point, index) => {
		const progress = index === 0 ? 0 : index === sourcePoints.length - 1 ? 1
			: (displayAtSource(point.source.num / point.source.den) - displayStart) / (displayEnd - displayStart);
		const localFrame = Math.round(progress * changes.durationFrames);
		return { source: point.source, outer: audioWarpOuterAtTimelineFrame(project, clip, clip.timelineStartFrame + localFrame), mode: 'forward' as const };
	});
	return { ...changes, warpMap: normalizeAudioWarpMap({ feature: 'audio-warp', points }), opaqueExtensions: clipSourceStretchExtensions(clip, source, map) };
}
