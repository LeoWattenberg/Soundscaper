/* SPDX-License-Identifier: AGPL-3.0-only */

import { evaluateAudioWarpMapAtSource } from './audio-warp-domain.ts';
import { createAudioWarpRuntimeEvaluator, type AudioWarpRuntimeProject } from './audio-warp-runtime.ts';
import { addRationals, beatToSampleFrame } from './timeline-time.ts';
import type { SampleEditClip, SamplePencilEdit, SamplePencilPoint } from './sample-edit-types.ts';

/** Reuse the authored map that supplies the visible waveform's sample position. */
export function warpedSampleSourceFrame(
	clip: SampleEditClip,
	project: AudioWarpRuntimeProject | null | undefined,
	timelineFrame: number,
): number | null {
	if (clip.warpMap == null) return null;
	if (!project) throw new TypeError('A warped sample edit requires the clip project.');
	const value = createAudioWarpRuntimeEvaluator(project, clip).sourceAtTimelineFrame(timelineFrame);
	return Math.min(clip.sourceStartFrame + clip.sourceDurationFrames - 1,
		Math.floor(value.num / value.den));
}

/** Interpolate a drawn line in timeline space, including changing warp rates. */
export function createWarpPencilSampleEdits(
	clip: SampleEditClip,
	project: AudioWarpRuntimeProject | null | undefined,
	channel: number,
	points: readonly SamplePencilPoint[],
	maximumFrames: number,
): readonly SamplePencilEdit[] | null {
	if (clip.warpMap == null) return null;
	if (!project) throw new TypeError('A warped sample edit requires the clip project.');
	const evaluator = createAudioWarpRuntimeEvaluator(project, clip);
	const normalized = points.map(point => {
		if (!Number.isSafeInteger(point.timelineFrame) || point.timelineFrame < clip.timelineStartFrame
			|| point.timelineFrame >= clip.timelineStartFrame + clip.durationFrames) {
			throw new RangeError('The sample-edit frame must be inside the selected clip.');
		}
		if (!Number.isFinite(point.value) || point.value < -1 || point.value > 1) {
			throw new RangeError('A pencil sample must be between -1 and 1.');
		}
		const source = evaluator.sourceAtTimelineFrame(point.timelineFrame);
		return { ...point, source: Math.min(clip.sourceStartFrame + clip.sourceDurationFrames - 1,
			Math.floor(source.num / source.den)) };
	});
	const edits = new Map<number, SamplePencilEdit>();
	const add = (frame: number, value: number): void => {
		edits.set(frame, { channel, frame, value });
		if (edits.size > maximumFrames) throw new RangeError(`A sample pencil stroke cannot exceed ${maximumFrames} source frames.`);
	};
	add(normalized[0]!.source, normalized[0]!.value);
	for (let index = 1; index < normalized.length; index += 1) {
		const previous = normalized[index - 1]!;
		const current = normalized[index]!;
		const distance = Math.abs(current.source - previous.source);
		if (!distance) { add(current.source, current.value); continue; }
		const direction = Math.sign(current.source - previous.source);
		for (let step = 1; step <= distance; step += 1) {
			const frame = previous.source + direction * step;
			const outer = evaluateAudioWarpMapAtSource(evaluator.map, frame);
			const timelineFrame = clip.anchor === 'musical'
				? beatToSampleFrame(addRationals(clip.musicalStartBeat!, outer), project.tempoMap, project.sampleRate)
				: clip.timelineStartFrame + outer.num / outer.den;
			const amount = Math.max(0, Math.min(1, (timelineFrame - previous.timelineFrame)
				/ (current.timelineFrame - previous.timelineFrame)));
			add(frame, previous.value + (current.value - previous.value) * amount);
		}
	}
	return Object.freeze([...edits.values()].sort((left, right) => left.frame - right.frame));
}
