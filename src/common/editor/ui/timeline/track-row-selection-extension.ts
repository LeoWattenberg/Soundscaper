/* SPDX-License-Identifier: AGPL-3.0-only */

import { audacityTrackRangeSelection } from '../../audacity-track-selection.ts';
import { resolveSelectionRange } from '../../selection-range.ts';

interface Project {
	readonly tracks: readonly { readonly id: string }[];
	readonly clips: readonly Readonly<{ readonly id: string; readonly timelineStartFrame?: number; readonly durationFrames?: number }>[];
	readonly selection?: Readonly<{
		readonly startFrame: number;
		readonly endFrame: number;
		readonly trackIds?: readonly string[];
	}> | null;
}

interface Controller {
	getSnapshot(): Readonly<{ project: Project | null }>;
	readonly actions: Readonly<{ timeline: Readonly<{
		adjustSelection(start: number, end: number, details: Readonly<{ trackIds: readonly string[] }>, options: Readonly<{ snap: false }>): unknown;
	}> }>;
}

/** Extend from the original row after focus routing finds a visible destination. */
export function extendTrackRowSelection(controller: Controller, anchorTrackId: string, targetIndex: number): unknown {
	const project = controller.getSnapshot().project;
	const target = project?.tracks[targetIndex];
	if (!project || !target) return null;
	const selection = resolveSelectionRange(project) ?? project.selection;
	const selectedTrackIds = selection?.trackIds?.length ? selection.trackIds : [anchorTrackId];
	const trackIds = audacityTrackRangeSelection({
		trackIds: project.tracks.map(track => track.id),
		focusedTrackId: target.id,
		selectedTrackIds,
	});
	return controller.actions.timeline.adjustSelection(selection?.startFrame ?? 0, selection?.endFrame ?? 0, { trackIds }, { snap: false });
}
