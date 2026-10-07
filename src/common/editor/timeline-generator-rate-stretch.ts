/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoGeneratorClipV1, type VideoGeneratorClipV1 } from './video-visual-model-v24.ts';
import { sampleFrameToVideoFrame } from './timeline-time.ts';
import type { TimelineGeneratorTrimClock } from './timeline-generator-trim.ts';

/** Stretch sequence time while retaining every native generated source frame. */
export function prepareTimelineGeneratorRateStretch(clock: TimelineGeneratorTrimClock,
	original: VideoGeneratorClipV1, edge: 'left' | 'right', boundarySample: number): VideoGeneratorClipV1 {
	const sequence = clock.sequences.find(item => item.id === original.sequenceId);
	if (!sequence) throw new ReferenceError('A generated visual stretch requires its sequence clock.');
	const boundary = sampleFrameToVideoFrame(boundarySample, sequence.rate, clock.sampleRate, 'point');
	const end = original.sequenceStartFrame + original.sequenceFrameCount;
	const start = edge === 'left' ? Math.max(0, Math.min(end - 1, boundary)) : original.sequenceStartFrame;
	const count = edge === 'left' ? end - start : Math.max(1, boundary - start);
	return normalizeVideoGeneratorClipV1({ ...original, sequenceStartFrame: start, sequenceFrameCount: count });
}
