/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateAudioWarpMapAtSource } from '../../../../audio-warp-domain.ts';
import { resolveRuntimeClipProjection } from '../../../../runtime-clip-projection.ts';
import { addRationals, beatToSampleFrame, normalizeRational, type RationalInput } from '../../../../timeline-time.ts';
import type { NyquistHostProject, NyquistLabel } from './nyquist-host-service.ts';

/** Source selections carry a native clock; label tracks always use project time. */
export function nyquistLabelTimelineRange(project: NyquistHostProject, label: NyquistLabel): readonly [number, number] {
	const start = Number(label.start || 0);
	const end = Number(label.end ?? label.start ?? 0);
	const target = label.sourceTarget;
	if (!target?.sourceClipId) {
		const from = Math.max(0, label.baseFrame + Math.round(start * project.sampleRate));
		return [from, Math.max(from, label.baseFrame + Math.round(end * project.sampleRate))];
	}
	const clip = project.clips.find(item => item.id === target.sourceClipId);
	if (!clip) throw new RangeError('The analyzed source clip is no longer available.');
	const geometry = resolveRuntimeClipProjection(project, clip);
	const sampleRate = target.sourceSampleRate ?? project.sampleRate;
	const from = projectFrame(target.startFrame + Math.round(start * sampleRate));
	const until = projectFrame(target.startFrame + Math.round(end * sampleRate));
	return [Math.max(0, Math.min(from, until)), Math.max(0, Math.max(from, until))];

	function projectFrame(sourceFrame: number): number {
		if (clip!.warpMap != null) {
			const outer = evaluateAudioWarpMapAtSource(clip!.warpMap, sourceFrame);
			if (clip!.anchor === 'musical' && project.tempoMap) {
				return beatToSampleFrame(addRationals(normalizeRational(clip!.musicalStartBeat as RationalInput), outer),
					project.tempoMap, project.sampleRate);
			}
			return Math.round(geometry.timelineStartFrame + outer.num / outer.den);
		}
		const offset = clip!.reversed
			? geometry.sourceEndFrame - sourceFrame : sourceFrame - geometry.sourceStartFrame;
		return Math.round(geometry.timelineStartFrame + offset * geometry.durationFrames / geometry.sourceDurationFrames);
	}
}
