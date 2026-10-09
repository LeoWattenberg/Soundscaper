/* SPDX-License-Identifier: AGPL-3.0-only */

import { snapAudioEditorFrameWithProject } from '../../snap-grid.js';
import { createBoundarySnapIndex, resolveBoundarySnap, type BoundarySnapIndex } from './boundary-snap.ts';

export type SelectionBoundaryEdge = 'start' | 'end';
/** Audacity's selection handle becomes active within three screen pixels. */
export const SELECTION_BOUNDARY_HIT_WIDTH = 3;

interface PointerSelection {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly trackIds?: readonly string[];
}

interface SelectionBoundaryHit {
	readonly selection: PointerSelection;
	readonly frame: number;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly trackId: string;
	readonly selectedTrackIds: ReadonlySet<string>;
	readonly shiftKey: boolean;
}

/** Shift chooses the closest edge; plain presses need a selected track and a range. */
export function resolveTimelineSelectionBoundaryEdge({
	selection, frame, pixelsPerSecond, sampleRate, trackId, selectedTrackIds, shiftKey,
}: SelectionBoundaryHit): SelectionBoundaryEdge | null {
	if (![frame, selection.startFrame, selection.endFrame, pixelsPerSecond, sampleRate].every(Number.isFinite)
		|| pixelsPerSecond <= 0 || sampleRate <= 0) return null;
	if (!shiftKey && (selection.endFrame <= selection.startFrame || !selectedTrackIds.has(trackId))) return null;
	if (selection.endFrame === selection.startFrame) return frame < selection.startFrame ? 'start' : 'end';
	const leftDistance = Math.abs(frame - selection.startFrame) * pixelsPerSecond / sampleRate;
	const rightDistance = Math.abs(frame - selection.endFrame) * pixelsPerSecond / sampleRate;
	if (!shiftKey && Math.min(leftDistance, rightDistance) > SELECTION_BOUNDARY_HIT_WIDTH) return null;
	return leftDistance <= rightDistance ? 'start' : 'end';
}

export interface TimelineSelectionBoundaryEdit {
	readonly kind: 'selection-resize';
	readonly edge: SelectionBoundaryEdge;
	readonly anchorFrame: number;
	readonly trackIds?: readonly string[];
	snapIndex?: BoundarySnapIndex;
}

/** Capture scope once, and keep the opposite endpoint pinned even after crossing it. */
export function createTimelineSelectionBoundaryEdit(
	selection: PointerSelection,
	edge: SelectionBoundaryEdge,
	playheadFrame: number,
	fallbackTrackIds?: readonly string[],
): TimelineSelectionBoundaryEdit {
	const hasRange = selection.endFrame > selection.startFrame;
	const trackIds = hasRange ? selection.trackIds : fallbackTrackIds;
	return {
		kind: 'selection-resize', edge,
		anchorFrame: hasRange ? (edge === 'start' ? selection.endFrame : selection.startFrame) : playheadFrame,
		...(trackIds ? { trackIds: [...trackIds] } : {}),
	};
}

interface SelectionBoundaryPreviewInput {
	readonly session: TimelineSelectionBoundaryEdit;
	readonly project: Parameters<typeof createBoundarySnapIndex>[0] & Readonly<{ sampleRate?: number; snap?: unknown }>;
	readonly rawFrame: number;
	readonly currentTrackId: string | null;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
}

/** Snap the moving endpoint only. Commits must keep this exact pinned range. */
export function previewTimelineSelectionBoundaryEdit({
	session, project, rawFrame, currentTrackId, pixelsPerSecond, sampleRate,
}: SelectionBoundaryPreviewInput): { selection: PointerSelection; guideFrames: number[] } {
	if (session.snapIndex?.project !== project) session.snapIndex = createBoundarySnapIndex(project);
	const snap = resolveBoundarySnap({
		project, index: session.snapIndex, frame: rawFrame, currentTrackId, pixelsPerSecond, sampleRate,
		rightEdge: rawFrame >= session.anchorFrame,
	});
	const frame = snap.snapped ? snap.frame : snapAudioEditorFrameWithProject(Math.round(rawFrame), project);
	return {
		selection: {
			startFrame: Math.min(session.anchorFrame, frame),
			endFrame: Math.max(session.anchorFrame, frame),
			...(session.trackIds ? { trackIds: session.trackIds } : {}),
		},
		guideFrames: snap.snapped ? [frame] : [],
	};
}
