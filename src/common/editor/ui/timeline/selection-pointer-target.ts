/* SPDX-License-Identifier: AGPL-3.0-only */

import { CLIP_TRIM_EDGE_HIT_WIDTH } from './constants.ts';
import { resolveTimelineSelectionBoundaryEdge, type SelectionBoundaryEdge } from './selection-pointer-edit.ts';
import { timelineSelectedTrackIds } from './track-selection-scope.ts';

export interface SelectionPointerEvent {
	readonly target: EventTarget | null;
	readonly clientX: number;
	readonly clientY: number;
	readonly shiftKey: boolean;
	readonly altKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
}

export interface SelectionPointerTargetOptions {
	readonly selection: Parameters<typeof resolveTimelineSelectionBoundaryEdge>[0]['selection'];
	readonly tracks: readonly Readonly<{ id: string; type?: string }>[];
	readonly selectedTrackId?: string | null;
	readonly frameAtClientX: (clientX: number, lane: HTMLElement) => number;
	readonly pixelsPerSecond: number;
	readonly sampleRate: number;
	readonly splitToolActive: boolean;
	readonly automationToolEnabled: boolean;
	readonly samplePencilActive: boolean;
	readonly playheadFrame?: () => number;
}

/** Keep trim, fade, clip-header, spectral and other dedicated tools ahead of selection handles. */
export function resolveTimelineSelectionPointerTarget(
	event: SelectionPointerEvent,
	options: SelectionPointerTargetOptions,
): { lane: HTMLElement; edge: SelectionBoundaryEdge } | null {
	const target = event.target as Element | null;
	if (typeof target?.closest !== 'function' || options.splitToolActive || event.altKey || event.ctrlKey || event.metaKey) return null;
	if (target.closest('button, input, textarea, select, [role="menuitem"], [data-track-header], .clip-header, .clip-display__handle, .audio-editor-vertical-ruler, [data-label-id], [data-timeline-annotation-interactive], [data-track-automation-interactive], [data-spectral-brush], [data-spectral-selection], [data-stereo-channel-divider], [data-crossfade-handle], [data-clip-fade-shape-handle], [data-clip-fade-handle]')) return null;
	const lane = target.closest<HTMLElement>('[data-track-lane]');
	const trackId = lane?.dataset.trackId;
	if (!lane || !trackId || lane.dataset.rulerInteraction !== undefined) return null;
	const track = options.tracks.find((candidate) => candidate.id === trackId);
	if (track?.type === 'audio' && (options.automationToolEnabled || options.samplePencilActive)) return null;
	const clipDisplay = target.closest('.clip-display');
	if (clipDisplay) {
		const rect = clipDisplay.getBoundingClientRect();
		const inTrimBand = event.clientY >= rect.top && event.clientY < rect.top + rect.height / 3;
		if (inTrimBand && Math.min(event.clientX - rect.left, rect.right - event.clientX) <= CLIP_TRIM_EDGE_HIT_WIDTH) return null;
	}
	const playheadFrame = options.playheadFrame?.();
	const selection = options.selection.endFrame > options.selection.startFrame || playheadFrame === undefined
		? options.selection : { startFrame: playheadFrame, endFrame: playheadFrame };
	const edge = resolveTimelineSelectionBoundaryEdge({
		selection,
		frame: options.frameAtClientX(event.clientX, lane),
		trackId,
		selectedTrackIds: timelineSelectedTrackIds(options.selection, options.selectedTrackId),
		shiftKey: event.shiftKey,
		pixelsPerSecond: options.pixelsPerSecond,
		sampleRate: options.sampleRate,
	});
	return edge ? { lane, edge } : null;
}

export function setTimelineSelectionPointerCursor(
	scrollRoot: HTMLElement | null | undefined,
	edge: SelectionBoundaryEdge | null,
) {
	if (!scrollRoot) return;
	if (edge) scrollRoot.dataset.selectionPointerEdge = edge;
	else delete scrollRoot.dataset.selectionPointerEdge;
}
