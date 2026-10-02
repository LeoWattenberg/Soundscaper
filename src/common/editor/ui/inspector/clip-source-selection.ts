/* SPDX-License-Identifier: AGPL-3.0-only */
import { clipSourceDisplayRange, clipDisplayFrameToSource, type ClipSourceTimingClip, type ClipSourceTimingProject, type ClipSourceTimingSource } from '../../clip-source-timing.ts';
import type { SourceSelection } from './clip-source-editor-types.ts';

/** A destructive edit must touch exactly the contiguous media the highlight represents. */
export function clipSourceSelection(project: ClipSourceTimingProject, clip: ClipSourceTimingClip, source: ClipSourceTimingSource, requested: SourceSelection | null): {
	readonly display: SourceSelection | null; readonly source: SourceSelection;
} {
	const range = clipSourceDisplayRange(clip, source, project.sampleRate);
	if (!requested) return { display: null, source: { startFrame: clip.sourceStartFrame, endFrame: clip.sourceStartFrame + clip.sourceDurationFrames } };
	let startFrame = Math.max(0, Math.min(range.totalFrames - 1, Math.round(requested.startFrame)));
	let endFrame = Math.min(range.totalFrames, Math.round(requested.endFrame));
	if (endFrame <= startFrame) return clipSourceSelection(project, clip, source, null);
	const nativeRate = source.sampleRate / project.sampleRate;
	const sourceEnd = clip.sourceStartFrame + clip.sourceDurationFrames;
	let first: number;
	let last: number;
	if (endFrame <= range.startFrame) {
		first = startFrame * nativeRate; last = endFrame * nativeRate;
	} else if (startFrame >= range.endFrame) {
		first = sourceEnd + (startFrame - range.endFrame) * nativeRate;
		last = sourceEnd + (endFrame - range.endFrame) * nativeRate;
	} else if (clip.reversed && (startFrame < range.startFrame || endFrame > range.endFrame)) {
		// One reversed seam has two disjoint source runs. Include the whole clip,
		// visibly, so the single-range effect API cannot silently edit other samples.
		startFrame = Math.min(startFrame, range.startFrame);
		endFrame = Math.max(endFrame, range.endFrame);
		first = startFrame < range.startFrame ? startFrame * nativeRate : clip.sourceStartFrame;
		last = endFrame > range.endFrame ? sourceEnd + (endFrame - range.endFrame) * nativeRate : sourceEnd;
	} else {
		first = clipDisplayFrameToSource(project, clip, source, startFrame);
		last = clipDisplayFrameToSource(project, clip, source, endFrame);
	}
	const sourceStart = Math.max(0, Math.min(source.frameCount - 1, Math.round(Math.min(first, last))));
	const sourceFinish = Math.max(sourceStart + 1, Math.min(source.frameCount, Math.round(Math.max(first, last))));
	return { display: { startFrame, endFrame }, source: { startFrame: sourceStart, endFrame: sourceFinish } };
}
