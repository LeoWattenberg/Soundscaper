/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareTimelineGeneratorRateStretch } from '../../timeline-generator-rate-stretch.ts';
import type { TimelineGeneratorTrimClock } from '../../timeline-generator-trim.ts';
import { videoFrameToSampleFrame } from '../../timeline-time.ts';
import { normalizeVideoGeneratorClipV1 } from '../../video-visual-model-v24.ts';
import type { TimelineTrimPointerSession } from './trim-pointer-routing.ts';

export interface GeneratorRateStretchProject extends TimelineGeneratorTrimClock {
	readonly tracks: readonly Readonly<{ id: string; clipIds?: readonly string[] }>[];
}

/** Preview and commit share one native generated visual compare-and-set mutation. */
export function prepareGeneratorRateStretchPointer(project: GeneratorRateStretchProject,
	session: TimelineTrimPointerSession, edge: 'left' | 'right', boundary: number) {
	const record = session.original;
	const original = normalizeVideoGeneratorClipV1({ schemaVersion: 1, kind: 'generator', id: record.id,
		sourceId: record.sourceId, sequenceId: record.sequenceId, sequenceStartFrame: record.sequenceStartFrame,
		sequenceFrameCount: record.sequenceFrameCount, sourceInFrame: record.sourceInFrame, sourceFrameCount: record.sourceFrameCount });
	const clip = prepareTimelineGeneratorRateStretch(project, original, edge, boundary);
	const sequence = project.sequences.find(item => item.id === clip.sequenceId)!;
	const track = project.tracks.find(item => item.clipIds?.includes(clip.id));
	if (!track) throw new ReferenceError('A generated visual stretch requires its timeline owner.');
	const start = videoFrameToSampleFrame(clip.sequenceStartFrame, sequence.rate, project.sampleRate, 'point');
	const end = videoFrameToSampleFrame(clip.sequenceStartFrame + clip.sequenceFrameCount, sequence.rate, project.sampleRate, 'point');
	const preview = { ...clip, clipId: clip.id, trackId: track.id, timelineStartFrame: start,
		durationFrames: end - start, sourceStartFrame: clip.sourceInFrame, sourceDurationFrames: clip.sourceFrameCount,
		rateStretchPreview: true, rateStretchGuideSample: edge === 'left' ? start : end, rateStretchGuideEdge: edge };
	const placement = { scope: 'timeline' as const, trackId: track.id };
	const command = clip.sequenceStartFrame === original.sequenceStartFrame && clip.sequenceFrameCount === original.sequenceFrameCount
		? null : { type: 'video-visual-clip/set' as const, clipId: clip.id, expectedClip: original,
			expectedPlacement: placement, clip, placement };
	return { preview: { ...preview, previews: [preview] }, command };
}
