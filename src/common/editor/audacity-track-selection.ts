/* SPDX-License-Identifier: AGPL-3.0-only */

interface AudacityTrackSelectionInput {
	readonly trackIds: readonly string[];
	readonly focusedTrackId: string | null;
	readonly selectedTrackIds: readonly string[];
}

interface AudacityTrackSelectionAdvanceInput extends AudacityTrackSelectionInput {
	readonly direction: number;
}

export interface AudacityTrackSelectionAdvance {
	readonly focusedTrackId: string;
	readonly selectedTrackIds: readonly string[];
}

/** Advance Audacity's focused track while extending or contracting one contiguous selection. */
export function advanceAudacityTrackSelection(
	input: AudacityTrackSelectionAdvanceInput,
): AudacityTrackSelectionAdvance | null {
	const trackIds = uniqueTrackIds(input.trackIds);
	if (trackIds.length === 0) return null;
	const direction = Math.sign(input.direction);
	const currentIndex = Math.max(0, trackIds.indexOf(input.focusedTrackId || ''));
	const nextIndex = Math.max(0, Math.min(trackIds.length - 1, currentIndex + direction));
	const requestedAnchor = input.selectedTrackIds[0] || '';
	const anchorIndex = trackIds.includes(requestedAnchor) ? trackIds.indexOf(requestedAnchor) : currentIndex;
	const anchorId = trackIds[anchorIndex];
	const range = trackIds.slice(Math.min(anchorIndex, nextIndex), Math.max(anchorIndex, nextIndex) + 1);

	return Object.freeze({
		focusedTrackId: trackIds[nextIndex],
		selectedTrackIds: Object.freeze([anchorId, ...range.filter((trackId) => trackId !== anchorId)]),
	});
}

/** Fill the complete Shift+Enter range between the current selection and focused track. */
export function audacityTrackRangeSelection(input: AudacityTrackSelectionInput): readonly string[] {
	const trackIds = uniqueTrackIds(input.trackIds);
	if (trackIds.length === 0) return Object.freeze([]);
	const focusedIndex = trackIds.indexOf(input.focusedTrackId || '');
	if (focusedIndex < 0) return Object.freeze([]);
	const anchorIndex = trackIds.indexOf(input.selectedTrackIds[0] || '');
	if (anchorIndex < 0) return Object.freeze([trackIds[focusedIndex]]);
	const anchorId = trackIds[anchorIndex];
	const range = trackIds.slice(
		Math.min(anchorIndex, focusedIndex),
		Math.max(anchorIndex, focusedIndex) + 1,
	);
	return Object.freeze([anchorId, ...range.filter((trackId) => trackId !== anchorId)]);
}

/** Replace or toggle the focused track without changing the timeline range. */
export function audacityToggledTrackSelection(
	input: AudacityTrackSelectionInput,
	mode: 'replace' | 'toggle',
): readonly string[] {
	const trackIds = uniqueTrackIds(input.trackIds);
	const focusedTrackId = input.focusedTrackId;
	if (!focusedTrackId || !trackIds.includes(focusedTrackId)) return Object.freeze([]);
	if (mode === 'replace') return Object.freeze([focusedTrackId]);
	const selected = [...new Set(input.selectedTrackIds.filter((trackId) => trackIds.includes(trackId)))];
	const focusedIndex = selected.indexOf(focusedTrackId);
	if (focusedIndex >= 0) selected.splice(focusedIndex, 1);
	else selected.push(focusedTrackId);
	return Object.freeze(selected);
}

function uniqueTrackIds(trackIds: readonly string[]): string[] {
	return [...new Set(trackIds.filter((trackId) => typeof trackId === 'string' && trackId.length > 0))];
}
