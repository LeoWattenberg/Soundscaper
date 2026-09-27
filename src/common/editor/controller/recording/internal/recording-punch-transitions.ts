/* SPDX-License-Identifier: AGPL-3.0-only */

import type { RecordingSegmentPunch } from './recording-finalization-types.ts';

/** A recorded take gets enough overlap to expose an editable automatic crossfade. */
const RECORDING_CROSSFADE_SECONDS = 0.05;

export function recordingPunchesWithTransitions(
	punches: readonly RecordingSegmentPunch[],
	projectSampleRate: number,
): readonly RecordingSegmentPunch[] {
	if (punches.length === 0) return punches;
	const transitionFrames = Math.max(1, Math.round(projectSampleRate * RECORDING_CROSSFADE_SECONDS));
	return punches.map((entry, index) => ({
		...entry,
		punch: {
			...entry.punch,
			...(index === 0 ? { transitionInFrames: transitionFrames } : {}),
			...(index === punches.length - 1 ? { transitionOutFrames: transitionFrames } : {}),
		},
	}));
}
