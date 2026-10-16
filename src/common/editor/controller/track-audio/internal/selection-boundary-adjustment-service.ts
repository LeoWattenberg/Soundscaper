/* SPDX-License-Identifier: AGPL-3.0-only */

import { audacitySelectionForAdjustment, audacityTimelinePixelFrames } from '../../../audacity-action-runtime-helpers.ts';
import { resolveSelectionRange } from '../../../selection-range.ts';
import { snapAudioEditorFrameWithProject } from '../../../snap-grid.js';
import type { SelectionViewProject, SelectionViewSelectionDetails } from './selection-view-service-types.d.ts';

interface SelectionBoundaryAdjustmentRuntime<Project extends SelectionViewProject> {
	readonly getProject: () => Project | null;
	readonly getPlayheadFrame: () => number;
	readonly projectSampleRate: () => number;
	readonly projectDurationFrames: (project: Project) => number;
	readonly state: {
		readonly selectedTrackId: string | null;
		readonly selectedClipId: string | null;
		readonly pixelsPerSecond: number;
	};
	readonly adjustSelection: (
		startFrame: number, endFrame: number, details: SelectionViewSelectionDetails,
		options: Readonly<{ snap?: boolean }>,
	) => Project;
}

/** Edit time boundaries around the selection, independently of the playhead. */
export function createSelectionBoundaryAdjustmentService<Project extends SelectionViewProject>(
	runtime: SelectionBoundaryAdjustmentRuntime<Project>,
) {
	let adjustedPoint: Project['selection'] | null = null;
	function rememberAdjustedSelection(selection: Project['selection']) {
		adjustedPoint = selection.endFrame <= selection.startFrame ? selection : null;
	}
	function selectionForAdjustment(project: Project) {
		const range = resolveSelectionRange(project, { selectedClipId: runtime.state.selectedClipId });
		const frames = project.selection === adjustedPoint ? project.selection
			: audacitySelectionForAdjustment(range || project.selection, runtime.getPlayheadFrame());
		const selectedTrackId = runtime.state.selectedTrackId;
		const trackIds = range ? range.trackIds
			: project.selection === adjustedPoint ? project.selection.trackIds ?? []
				: project.selection.trackIds?.length ? project.selection.trackIds
					: selectedTrackId ? [selectedTrackId] : [];
		return {
			...frames,
			details: { trackIds, clipIds: [], frequencyRange: project.selection.frequencyRange ?? null },
		};
	}

	function adjustBoundary(boundary: 'start' | 'end', direction: -1 | 1) {
		const project = runtime.getProject();
		if (!project) return null;
		const selection = selectionForAdjustment(project);
		const contracts = boundary === 'start' ? direction > 0 : direction < 0;
		if (contracts && selection.endFrame <= selection.startFrame) return null;
		const frame = boundary === 'start' ? selection.startFrame : selection.endFrame;
		const pixelStep = audacityTimelinePixelFrames(runtime.projectSampleRate(), runtime.state.pixelsPerSecond);
		const pixelTarget = Math.max(0, frame + direction * pixelStep);
		// Directional snapping reaches a grid point at least one screen pixel
		// away, including at zoom levels where several grid points share a pixel.
		const target = snapAudioEditorFrameWithProject(pixelTarget, project, {
			mode: direction < 0 ? 'previous' : 'next',
		});
		const startFrame = boundary === 'start' ? Math.min(selection.endFrame, target) : selection.startFrame;
		const endFrame = boundary === 'end' ? Math.max(selection.startFrame, target) : selection.endFrame;
		const next = runtime.adjustSelection(startFrame, endFrame, selection.details, { snap: false }).selection;
		rememberAdjustedSelection(next);
		return next;
	}

	function extendToProjectBoundary(boundary: 'start' | 'end') {
		const project = runtime.getProject();
		if (!project) return null;
		const selection = selectionForAdjustment(project);
		const endFrame = boundary === 'end' ? runtime.projectDurationFrames(project) : selection.endFrame;
		const next = runtime.adjustSelection(
			boundary === 'start' ? 0 : Math.min(selection.startFrame, endFrame),
			endFrame,
			selection.details, { snap: false },
		).selection;
		rememberAdjustedSelection(next);
		return next;
	}

	return Object.freeze({
		rememberAdjustedSelection,
		extendSelectionLeft: () => adjustBoundary('start', -1),
		extendSelectionRight: () => adjustBoundary('end', 1),
		contractSelectionLeft: () => adjustBoundary('start', 1),
		contractSelectionRight: () => adjustBoundary('end', -1),
		extendSelectionToProjectStart: () => extendToProjectBoundary('start'),
		extendSelectionToProjectEnd: () => extendToProjectBoundary('end'),
	});
}
