/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveRuntimeClipProjection } from '../../../runtime-clip-projection.ts';
import { sequenceFrameBoundarySample } from '../../../sequence-frame-navigation.ts';
import type { RationalRate } from '../../../timeline-time.ts';
import type { ClipSelectionNavigationProject } from './clip-selection-navigation-service.ts';
import type { SelectionViewClip, SelectionViewProject } from './selection-view-service-types.d.ts';

export interface SelectedTrackContentRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

/** A track region measures authored content, independently of the viewport tail. */
export function selectedTrackContentRange(
	project: SelectionViewProject,
	requestedTrackIds: readonly string[],
	emptyTrackDuration: () => number,
): SelectedTrackContentRange | null {
	const selectedIds = new Set(requestedTrackIds);
	const tracks = project.tracks.filter(track => selectedIds.has(track.id));
	const clipById = new Map(project.clips.map(clip => [clip.id, clip]));
	const ranges: SelectedTrackContentRange[] = [];
	for (const track of tracks) {
		if (track.type === 'label') {
			for (const label of track.labels ?? []) {
				if (isFrame(label.startFrame) && isFrame(label.endFrame)) ranges.push({ startFrame: label.startFrame, endFrame: label.endFrame });
			}
		} else {
			for (const clipId of track.clipIds ?? []) {
				const clip = clipById.get(clipId);
				const range = clip ? clipContentRange(project, clip) : null;
				if (range) ranges.push(range);
			}
		}
	}
	if (!ranges.length) return tracks.length ? { startFrame: 0, endFrame: emptyTrackDuration() } : null;
	return {
		startFrame: Math.min(...ranges.map(range => range.startFrame)),
		endFrame: Math.max(...ranges.map(range => range.endFrame)),
	};
}

export function clipContentRange(project: ClipSelectionNavigationProject, clip: SelectionViewClip): SelectedTrackContentRange | null {
	if (isFrame(clip.sequenceStartFrame) && isFrame(clip.sequenceFrameCount)) {
		const sequenceId = clip.sequenceId ?? project.primarySequenceId;
		const sequence = project.sequences?.find(candidate => candidate.id === sequenceId);
		const rate = sequence?.rate as RationalRate | undefined;
		if (!rate) throw new RangeError('Selected visual content requires its sequence rate.');
		return {
			startFrame: sequenceFrameBoundarySample(clip.sequenceStartFrame, rate, project.sampleRate),
			endFrame: sequenceFrameBoundarySample(clip.sequenceStartFrame + clip.sequenceFrameCount, rate, project.sampleRate),
		};
	}
	if (clip.anchor === 'musical') {
		return projectedClipContentRange(project, clip);
	}
	return isFrame(clip.timelineStartFrame) && isFrame(clip.durationFrames)
		? { startFrame: clip.timelineStartFrame, endFrame: clip.timelineStartFrame + clip.durationFrames } : null;
}

function projectedClipContentRange(project: ClipSelectionNavigationProject, clip: SelectionViewClip): SelectedTrackContentRange {
	const resolved = resolveRuntimeClipProjection(project, clip);
	return { startFrame: resolved.timelineStartFrame, endFrame: resolved.timelineEndFrame };
}

function isFrame(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}
