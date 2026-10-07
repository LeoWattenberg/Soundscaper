/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareTimelineGeneratorTrim, type TimelineGeneratorTrimClock } from '../../timeline-generator-trim.ts';
import { videoFrameToSampleFrame } from '../../timeline-time.ts';
import { normalizeVideoGeneratorClipV1 } from '../../video-visual-model-v24.ts';
import type { TimelineTrimPointerSession } from './trim-pointer-routing.ts';

interface GeneratorPreviewProject extends TimelineGeneratorTrimClock {
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly tracks: readonly Readonly<{ id: string; clipIds?: readonly string[] }>[];
}

/** Preview the same exact generator window that the owning command will publish. */
export function createGeneratorTrimPointerPreview(project: GeneratorPreviewProject, session: TimelineTrimPointerSession,
	edge: 'left' | 'right', boundary: number): Readonly<Record<string, unknown>> {
	const source = project.sources.find(item => item.id === session.original.sourceId);
	if (source?.kind !== 'generator' || typeof source.frameCount !== 'number') throw new ReferenceError('A generator preview requires its native source.');
	const record = session.original;
	const original = normalizeVideoGeneratorClipV1({ schemaVersion: 1, kind: 'generator', id: record.id,
		sourceId: record.sourceId, sequenceId: record.sequenceId, sequenceStartFrame: record.sequenceStartFrame,
		sequenceFrameCount: record.sequenceFrameCount, sourceInFrame: record.sourceInFrame, sourceFrameCount: record.sourceFrameCount });
	const clip = prepareTimelineGeneratorTrim(project, original, { frameCount: source.frameCount },
		edge === 'left' ? { timelineStartFrame: boundary } : { durationFrames: boundary - Number(session.original.timelineStartFrame) });
	const sequence = project.sequences.find(item => item.id === clip.sequenceId)!;
	const start = videoFrameToSampleFrame(clip.sequenceStartFrame, sequence.rate, project.sampleRate, 'point');
	const end = videoFrameToSampleFrame(clip.sequenceStartFrame + clip.sequenceFrameCount, sequence.rate, project.sampleRate, 'point');
	const preview = { ...clip, clipId: clip.id, trackId: project.tracks.find(track => track.clipIds?.includes(clip.id))?.id,
		timelineStartFrame: start, durationFrames: end - start, waveformPreviewKind: 'trim',
		sourceStartFrame: clip.sourceInFrame, sourceDurationFrames: clip.sourceFrameCount };
	return { ...preview, previews: [preview] };
}
