/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoGeneratorClipV1, type VideoGeneratorClipV1 } from './video-visual-model-v24.ts';
import { sampleFrameToVideoFrame, videoFrameToSampleFrame, type RationalRate } from './timeline-time.ts';

export interface TimelineGeneratorTrimClock {
	readonly sampleRate: number;
	readonly sequences: readonly Readonly<{ id: string; rate: RationalRate }>[];
}

/** A generator's sequence edge and native source window move together. */
export function prepareTimelineGeneratorTrim(clock: TimelineGeneratorTrimClock, original: VideoGeneratorClipV1,
	source: Readonly<{ frameCount: number }>, changes: Readonly<{ timelineStartFrame?: number; durationFrames?: number }>): VideoGeneratorClipV1 {
	const sequence = clock.sequences.find(item => item.id === original.sequenceId);
	if (!sequence) throw new ReferenceError('A generator trim requires its sequence clock.');
	const ratio = original.sourceFrameCount / original.sequenceFrameCount;
	const end = original.sequenceStartFrame + original.sequenceFrameCount;
	const requestedStart = changes.timelineStartFrame === undefined ? original.sequenceStartFrame
		: sampleFrameToVideoFrame(changes.timelineStartFrame, sequence.rate, clock.sampleRate, 'point');
	const availableLeft = Math.floor(original.sourceInFrame / ratio);
	const start = Math.max(0, original.sequenceStartFrame - availableLeft, Math.min(end - 1, requestedStart));
	const startSample = videoFrameToSampleFrame(start, sequence.rate, clock.sampleRate, 'point');
	const requestedEnd = changes.durationFrames === undefined ? end
		: sampleFrameToVideoFrame(startSample + Math.max(1, changes.durationFrames), sequence.rate, clock.sampleRate, 'point');
	const sourceInFrame = Math.min(original.sourceInFrame + original.sourceFrameCount - 1,
		Math.max(0, original.sourceInFrame + Math.round((start - original.sequenceStartFrame) * ratio)));
	const maximumCount = Math.max(1, Math.floor((source.frameCount - sourceInFrame) / ratio));
	const sequenceFrameCount = Math.max(1, Math.min(maximumCount, requestedEnd - start));
	const sourceFrameCount = Math.max(1, Math.min(source.frameCount - sourceInFrame, Math.round(sequenceFrameCount * ratio)));
	return normalizeVideoGeneratorClipV1({ ...original, sequenceStartFrame: start,
		sequenceFrameCount, sourceInFrame, sourceFrameCount });
}
