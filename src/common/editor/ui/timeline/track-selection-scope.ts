/* SPDX-License-Identifier: AGPL-3.0-only */

interface TrackSelectionScopeSelection {
	readonly trackIds?: unknown;
}

/**
 * The tracks a time selection acts on.
 *
 * Audacity paints a selected range only inside the selected tracks, and the
 * document carries the same idea in `selection.trackIds`. A plain drag across
 * the ruler leaves that list empty, so the edit services fall back to the
 * focused track — see `clipboard-edit-service` and `audacity-action-parity`.
 * The timeline shades exactly those tracks, so the highlight always names the
 * tracks the next edit would touch.
 */
export function timelineSelectedTrackIds(
	selection: TrackSelectionScopeSelection | null | undefined,
	focusedTrackId: unknown,
): ReadonlySet<string> {
	const trackIds = selection?.trackIds;
	const selected = Array.isArray(trackIds)
		? trackIds.filter((trackId): trackId is string => typeof trackId === 'string' && trackId !== '')
		: [];
	if (selected.length) return new Set(selected);
	return new Set(typeof focusedTrackId === 'string' && focusedTrackId ? [focusedTrackId] : []);
}

interface SelectionDragLane {
	readonly dataset: Readonly<{ trackId?: string; rulerInteraction?: string }>;
	getBoundingClientRect(): Readonly<{ top: number; bottom: number }>;
}

interface SelectionDragScrollRoot {
	querySelectorAll(selector: string): Iterable<SelectionDragLane>;
}

/** Read current lane geometry so captured pointers and scrolling retain the drag's track span. */
export function timelineSelectionDragTrackIds(
	startLane: SelectionDragLane,
	scrollRoot: SelectionDragScrollRoot | null | undefined,
	clientY: number,
): string[] | undefined {
	const startTrackId = startLane.dataset.trackId;
	if (!startTrackId || startLane.dataset.rulerInteraction !== undefined) return undefined;
	const startRect = startLane.getBoundingClientRect();
	const anchorY = (startRect.top + startRect.bottom) / 2;
	const top = Math.min(anchorY, clientY);
	const bottom = Math.max(anchorY, clientY);
	const trackIds = new Set<string>();
	for (const lane of scrollRoot?.querySelectorAll('[data-track-lane]') ?? []) {
		const trackId = lane.dataset.trackId;
		if (!trackId || lane.dataset.rulerInteraction !== undefined) continue;
		const rect = lane.getBoundingClientRect();
		if (rect.bottom > rect.top && rect.bottom > top && rect.top <= bottom) trackIds.add(trackId);
	}
	trackIds.add(startTrackId);
	return [...trackIds];
}
