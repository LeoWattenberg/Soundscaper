/* SPDX-License-Identifier: AGPL-3.0-only */

import { createBoundarySnapIndex, resolveBoundarySnap, type BoundarySnapIndex } from './boundary-snap.ts';
import { timelineSelectionDragTrackIds } from './track-selection-scope.ts';

interface SelectionDragSession {
	readonly lane: HTMLElement;
	readonly startFrame: number;
	readonly startSnapGuideFrame?: number | null;
	readonly snapDisabled?: boolean;
	snapIndex?: BoundarySnapIndex;
	lastRawEndFrame?: number;
	lastTrackIds?: string[];
	boundarySnapped?: boolean;
}

/** Share selection preview calculations while leaving initial click/seek semantics with its owner. */
export function previewTimelineSelectionDrag({
	session, project, rawEndFrame, clientY, scrollRoot, pixelsPerSecond, sampleRate,
}: {
	readonly session: SelectionDragSession;
	readonly project: Parameters<typeof createBoundarySnapIndex>[0];
	readonly rawEndFrame: number;
	readonly clientY: number;
	readonly scrollRoot: HTMLElement | null;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
}) {
	if (!session.snapDisabled && session.snapIndex?.project !== project) session.snapIndex = createBoundarySnapIndex(project);
	const endSnap = session.snapDisabled ? { frame: rawEndFrame, snapped: false } : resolveBoundarySnap({
		project, index: session.snapIndex, frame: rawEndFrame,
		currentTrackId: session.lane.dataset.trackId ?? null,
		pixelsPerSecond, sampleRate, rightEdge: rawEndFrame >= session.startFrame,
	});
	const trackIds = timelineSelectionDragTrackIds(session.lane, scrollRoot, clientY);
	session.lastRawEndFrame = rawEndFrame;
	session.lastTrackIds = trackIds;
	session.boundarySnapped = Number.isSafeInteger(session.startSnapGuideFrame) || endSnap.snapped;
	return {
		selection: {
			startFrame: Math.min(session.startFrame, endSnap.frame),
			endFrame: Math.max(session.startFrame, endSnap.frame),
			trackIds,
		},
		guideFrames: [...new Set([
			session.startSnapGuideFrame, endSnap.snapped ? endSnap.frame : null,
		].filter((frame): frame is number => Number.isSafeInteger(frame)))],
	};
}
