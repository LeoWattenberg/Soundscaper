/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoTimingIndex } from '../video-timing-asset.ts';
import {
	roundRational,
	sampleFrameToVideoFrame,
	videoFrameToSampleFrame,
	type RationalRate,
} from '../timeline-time.ts';

export interface VideoImportTimingInput {
	readonly metadataDurationFrames: number;
	readonly sampleRate: number;
	readonly timingIndex: VideoTimingIndex | null;
	readonly timelineStartFrame: number;
	readonly sequenceRate: RationalRate;
}

export interface VideoImportTimingPlan {
	readonly sourceDurationFrames: number;
	readonly sequenceStartFrame: number;
	readonly sequenceEndFrame: number;
	readonly timelineStartFrame: number;
	readonly timelineDurationFrames: number;
}

/** Resolve exact media timing first, then quantize one aligned A/V placement. */
export function planVideoImportTiming(input: VideoImportTimingInput): Readonly<VideoImportTimingPlan> {
	const sourceDurationFrames = input.timingIndex === null
		? input.metadataDurationFrames
		: Math.max(1, roundRational(
			input.timingIndex.endTicks * BigInt(input.sampleRate),
			BigInt(input.timingIndex.timescale),
			'point',
		));
	const sequenceStartFrame = sampleFrameToVideoFrame(
		input.timelineStartFrame, input.sequenceRate, input.sampleRate, 'point',
	);
	const sequenceEndFrame = Math.max(sequenceStartFrame + 1, sampleFrameToVideoFrame(
		input.timelineStartFrame + sourceDurationFrames,
		input.sequenceRate,
		input.sampleRate,
		'point',
	));
	const timelineStartFrame = videoFrameToSampleFrame(
		sequenceStartFrame, input.sequenceRate, input.sampleRate, 'point',
	);
	const timelineEndFrame = videoFrameToSampleFrame(
		sequenceEndFrame, input.sequenceRate, input.sampleRate, 'point',
	);
	return Object.freeze({
		sourceDurationFrames,
		sequenceStartFrame,
		sequenceEndFrame,
		timelineStartFrame,
		timelineDurationFrames: timelineEndFrame - timelineStartFrame,
	});
}
