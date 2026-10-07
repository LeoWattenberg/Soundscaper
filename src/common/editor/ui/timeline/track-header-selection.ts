/* SPDX-License-Identifier: AGPL-3.0-only */

import { audacityTrackRangeSelection, audacityToggledTrackSelection } from '../../audacity-track-selection.ts';
import { resolveSelectionRange } from '../../selection-range.ts';

interface TrackHeaderSelectionController {
	getSnapshot(): Readonly<{ project: Readonly<{
		tracks: readonly Readonly<{ id: string }>[];
		selection?: Readonly<{ startFrame: number; endFrame: number; trackIds?: readonly string[] }> | null;
	}> | null }>;
	readonly actions: { readonly timeline: {
		selectTrack(trackId: string | null): unknown;
		setExactSelection(startFrame: number, endFrame: number, details: Readonly<{ trackIds: readonly string[] }>): unknown;
	} };
}

/** Bind the existing panel's pointer and Enter selection callbacks to exact time bounds. */
export function selectTrackFromHeader(controller: TrackHeaderSelectionController, trackId: string, mode: 'replace' | 'toggle' | 'range'): unknown {
	const project = controller.getSnapshot().project;
	if (!project) return null;
	const input = { trackIds: project.tracks.map(track => track.id), focusedTrackId: trackId,
		selectedTrackIds: project.selection?.trackIds ?? [] };
	const trackIds = mode === 'range' ? audacityTrackRangeSelection(input) : audacityToggledTrackSelection(input, mode);
	const range = resolveSelectionRange(project) ?? project.selection;
	controller.actions.timeline.selectTrack(trackIds.includes(trackId) ? trackId : null);
	return controller.actions.timeline.setExactSelection(range?.startFrame ?? 0, range?.endFrame ?? 0, { trackIds });
}
