/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareTimelineImageTrim, type TimelineImageTrimClock, type TimelineImageTrimSource } from '../../timeline-image-trim.ts';
import { videoFrameToSampleFrame } from '../../timeline-time.ts';
import type { FramescaperImageClipV1 } from '../../timeline-image-model.ts';
import type { TimelineTrimPointerSession } from './trim-pointer-routing.ts';

interface ImagePreviewProject extends TimelineImageTrimClock {
	readonly sources: readonly Readonly<Record<string, unknown>>[];
	readonly tracks: readonly Readonly<{ id: string; clipIds?: readonly string[] }>[];
}

/** Share the exact image trim clock with commit while keeping previews out of history. */
export function createImageTrimPointerPreview(project: ImagePreviewProject, session: TimelineTrimPointerSession,
	edge: 'left' | 'right', boundary: number): Readonly<Record<string, unknown>> {
	const original = session.original;
	const source = project.sources.find(item => item.id === original.sourceId);
	if (source?.kind !== 'image') throw new ReferenceError('An image preview requires its source.');
	const clip = prepareTimelineImageTrim(project, original as unknown as FramescaperImageClipV1,
		source as unknown as TimelineImageTrimSource, edge === 'left' ? { timelineStartFrame: boundary }
			: { durationFrames: boundary - Number(original.timelineStartFrame) });
	const sequence = project.sequences.find(item => item.id === clip.sequenceId)!;
	const start = videoFrameToSampleFrame(clip.sequenceStartFrame, sequence.rate, project.sampleRate);
	const end = videoFrameToSampleFrame(clip.sequenceStartFrame + clip.sequenceFrameCount, sequence.rate, project.sampleRate);
	const preview = { ...clip, clipId: clip.id, trackId: project.tracks.find(track => track.clipIds?.includes(clip.id))?.id,
		timelineStartFrame: start, durationFrames: end - start, waveformPreviewKind: 'trim',
		sourceStartFrame: original.sourceStartFrame, sourceDurationFrames: original.sourceDurationFrames };
	return { ...preview, previews: [preview] };
}
