/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClipLoop } from './audio-clip-loop.ts';
import type { SampleEditClip, SamplePencilEdit, SamplePencilPoint } from './sample-edit-types.ts';

/** Interpolate continuously through repeats, then publish source-addressed edits. */
export function createLoopPencilSampleEdits(
	clip: SampleEditClip,
	channel: number,
	points: readonly SamplePencilPoint[],
	maximumFrames: number,
): readonly SamplePencilEdit[] | null {
	const loop = readClipLoop(clip);
	if (!loop) return null;
	const normalized = points.map(point => {
		const frame = Number(point.timelineFrame);
		if (!Number.isSafeInteger(frame) || frame < clip.timelineStartFrame
			|| frame >= clip.timelineStartFrame + clip.durationFrames) {
			throw new RangeError('The sample-edit frame must be inside the selected clip.');
		}
		const value = Number(point.value);
		if (!Number.isFinite(value) || value < -1 || value > 1) throw new RangeError('A pencil sample must be between -1 and 1.');
		return { position: Math.floor((frame - clip.timelineStartFrame + loop.offsetFrames)
			* clip.sourceDurationFrames / loop.periodFrames), value };
	});
	const edits = new Map<number, SamplePencilEdit>();
	const add = (position: number, value: number) => {
		const phase = position % clip.sourceDurationFrames;
		const frame = clip.sourceStartFrame + (clip.reversed ? clip.sourceDurationFrames - 1 - phase : phase);
		edits.set(frame, { channel, frame, value });
		if (edits.size > maximumFrames) throw new RangeError(`A sample pencil stroke cannot exceed ${maximumFrames} source frames.`);
	};
	add(normalized[0].position, normalized[0].value);
	for (let index = 1; index < normalized.length; index += 1) {
		const previous = normalized[index - 1];
		const current = normalized[index];
		const distance = Math.abs(current.position - previous.position);
		if (!distance) { add(current.position, current.value); continue; }
		const direction = Math.sign(current.position - previous.position);
		// Later points win. Earlier full repetitions will all be overwritten.
		const firstStep = Math.max(1, distance - clip.sourceDurationFrames + 1);
		for (let step = firstStep; step <= distance; step += 1) {
			add(previous.position + direction * step,
				previous.value + (current.value - previous.value) * step / distance);
		}
	}
	return Object.freeze([...edits.values()].sort((left, right) => left.frame - right.frame));
}
