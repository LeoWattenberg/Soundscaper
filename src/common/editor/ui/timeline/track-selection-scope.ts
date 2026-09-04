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
