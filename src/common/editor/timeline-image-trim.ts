/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_IMAGE_TICKS_PER_SECOND, normalizeFramescaperImageClipV1, type FramescaperImageClipV1 } from './timeline-image-model.ts';
import { sampleFrameToVideoFrame, videoFrameToSampleFrame, type RationalRate } from './timeline-time.ts';

export interface TimelineImageTrimClock {
	readonly sampleRate: number;
	readonly sequences: readonly Readonly<{ id: string; rate: RationalRate }>[];
}

export interface TimelineImageTrimSource {
	readonly canonical: Readonly<{ durationTicks: string }>;
}

/** Images hold their final frame, so trimming uses sequence boundaries rather than audio EOF. */
export function prepareTimelineImageTrim(clock: TimelineImageTrimClock, original: FramescaperImageClipV1,
	source: TimelineImageTrimSource, changes: Readonly<{ timelineStartFrame?: number; durationFrames?: number }>): FramescaperImageClipV1 {
	const sequence = clock.sequences.find(item => item.id === original.sequenceId);
	if (!sequence) throw new ReferenceError('An image trim requires its sequence clock.');
	const end = original.sequenceStartFrame + original.sequenceFrameCount;
	const ticksPerFrameNumerator = BigInt(FRAMESCAPER_IMAGE_TICKS_PER_SECOND) * BigInt(sequence.rate.den);
	const availableLeftFrames = Number(BigInt(original.sourceStartTicks) * BigInt(sequence.rate.num) / ticksPerFrameNumerator);
	const requestedStart = changes.timelineStartFrame === undefined ? original.sequenceStartFrame
		: sampleFrameToVideoFrame(changes.timelineStartFrame, sequence.rate, clock.sampleRate);
	const start = Math.max(0, original.sequenceStartFrame - availableLeftFrames, Math.min(end - 1, requestedStart));
	const startSample = videoFrameToSampleFrame(start, sequence.rate, clock.sampleRate);
	const requestedEnd = changes.durationFrames === undefined ? end
		: sampleFrameToVideoFrame(startSample + Math.max(1, changes.durationFrames), sequence.rate, clock.sampleRate);
	const count = Math.max(1, requestedEnd - start);
	const elapsed = BigInt(start - original.sequenceStartFrame) * ticksPerFrameNumerator / BigInt(sequence.rate.num);
	const phase = BigInt(original.sourceStartTicks) + elapsed;
	const finalTick = BigInt(source.canonical.durationTicks) - 1n;
	return normalizeFramescaperImageClipV1({ schemaVersion: original.schemaVersion, kind: 'image', id: original.id,
		sourceId: original.sourceId, sequenceId: original.sequenceId, sequenceStartFrame: start,
		sequenceFrameCount: count, sourceStartTicks: String(phase > finalTick ? finalTick : phase) });
}
