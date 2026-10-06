/* SPDX-License-Identifier: AGPL-3.0-only */

import { clipLoopSegmentFields, clipLoopUpdateFields, readClipLoop, type LoopAudioClip } from '../audio-clip-loop.ts';

interface JoinClip extends LoopAudioClip {
	readonly timelineStartFrame: number;
}

/** Reconstruct a repeated source only when every selected part plays the same loop sequence. */
export function clipLoopJoinFields(clips: readonly JoinClip[]) {
	const first = clips[0];
	const last = clips.at(-1);
	const reference = clips.find((clip) => readClipLoop(clip));
	if (!first || !last || !reference) return null;
	const loop = readClipLoop(reference)!;
	const periodFrames = loop.periodFrames;
	const offsetFrames = ((loop.offsetFrames - (reference.timelineStartFrame - first.timelineStartFrame))
		% periodFrames + periodFrames) % periodFrames;
	const durationFrames = last.timelineStartFrame + last.durationFrames - first.timelineStartFrame;
	const carrier = { ...first, sourceStartFrame: reference.sourceStartFrame,
		sourceDurationFrames: reference.sourceDurationFrames, durationFrames };
	const fields = clipLoopUpdateFields(carrier, { periodFrames, offsetFrames, durationFrames });
	const joined = { ...carrier, ...fields };
	for (const clip of clips) {
		const expected = clipLoopSegmentFields(joined, clip.timelineStartFrame - first.timelineStartFrame, clip.durationFrames);
		if (!expected || expected.sourceStartFrame !== clip.sourceStartFrame
			|| expected.sourceDurationFrames !== clip.sourceDurationFrames
			|| !sameLoop(readClipLoop(expected), readClipLoop(clip))) return null;
	}
	return { durationFrames: fields.durationFrames, sourceStartFrame: fields.sourceStartFrame,
		sourceDurationFrames: fields.sourceDurationFrames, opaqueExtensions: fields.opaqueExtensions };
}

function sameLoop(left: ReturnType<typeof readClipLoop>, right: ReturnType<typeof readClipLoop>) {
	return left === null ? right === null : right !== null
		&& left.periodFrames === right.periodFrames && left.offsetFrames === right.offsetFrames;
}
