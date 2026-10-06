/* SPDX-License-Identifier: AGPL-3.0-only */

import { createEnvelopeValueEvaluator } from '../automation.js';

interface ClipEnvelopePoint {
	readonly frame: number;
	readonly value: number;
}

interface EnvelopedClip {
	readonly durationFrames: number;
	readonly envelope?: readonly ClipEnvelopePoint[];
}

/** Preserve each clip's sampled gain, including independent defaults at its seams. */
export function joinClipEnvelopes(clips: readonly EnvelopedClip[]): ClipEnvelopePoint[] {
	if (!clips.some(clip => clip.envelope?.length)) return [];
	const result: ClipEnvelopePoint[] = [];
	let offset = 0;
	for (const [index, clip] of clips.entries()) {
		const evaluate = createEnvelopeValueEvaluator(clip.envelope, clip.durationFrames);
		const lastFrame = clip.durationFrames - 1;
		const points = new Map<number, number>([[0, evaluate(0)], [lastFrame, evaluate(lastFrame)]]);
		for (const point of clip.envelope ?? []) {
			if (point.frame > 0 && point.frame < lastFrame) points.set(point.frame, point.value);
		}
		for (const [frame, value] of [...points].sort(([left], [right]) => left - right)) {
			result.push({ frame: offset + frame, value });
		}
		offset += clip.durationFrames;
		if (index === clips.length - 1) result.push({ frame: offset, value: evaluate(clip.durationFrames) });
	}
	return result;
}
