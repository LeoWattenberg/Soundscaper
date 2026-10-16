/* SPDX-License-Identifier: AGPL-3.0-only */

import { secondsToSampleFrame } from '../../../timeline-time.ts';

interface RecordingRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

interface RecordingAlignmentInput {
	readonly sampleRate: number;
	readonly requestedStartFrame: number;
	readonly automaticLatencySeconds: number;
	readonly manualOffsetMs: number;
	readonly selection: RecordingRange | null;
}

/** Positive compensation advances captured audio; a negative total delays its placement. */
export function recordingSourceAlignment(input: RecordingAlignmentInput): Readonly<{
	latencyFrames: number;
	recordingStartFrame: number;
	sourceOffsetProjectFrames: number;
	selection: RecordingRange | null;
}> {
	const seconds = input.automaticLatencySeconds + input.manualOffsetMs / 1_000;
	const latencyFrames = Math.sign(seconds) * secondsToSampleFrame(Math.abs(seconds), input.sampleRate, 'point');
	const recordingStartFrame = input.selection
		? input.requestedStartFrame + Math.max(0, -latencyFrames)
		: Math.max(0, input.requestedStartFrame - latencyFrames);
	const sourceOffsetProjectFrames = input.selection
		? Math.max(0, latencyFrames)
		: Math.max(0, latencyFrames - input.requestedStartFrame);
	if (!Number.isSafeInteger(recordingStartFrame) || !Number.isSafeInteger(sourceOffsetProjectFrames)) {
		throw new RangeError('Recording alignment exceeds the sample-frame domain.');
	}
	if (input.selection && recordingStartFrame >= input.selection.endFrame) {
		throw new RangeError('The recording offset leaves no audio inside the selected range.');
	}
	return Object.freeze({ latencyFrames, recordingStartFrame, sourceOffsetProjectFrames,
		selection: input.selection ? Object.freeze({ startFrame: recordingStartFrame, endFrame: input.selection.endFrame }) : null });
}
