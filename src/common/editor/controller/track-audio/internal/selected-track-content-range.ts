/* SPDX-License-Identifier: AGPL-3.0-only */

import { clipContentRange } from '../../../clip-content-range.ts';
import type { SelectionViewProject } from './selection-view-service-types.d.ts';

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


function isFrame(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}
