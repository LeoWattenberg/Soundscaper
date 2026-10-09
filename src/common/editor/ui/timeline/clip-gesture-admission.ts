/* SPDX-License-Identifier: AGPL-3.0-only */

interface Track {
	readonly locked?: boolean;
	readonly clipIds?: readonly string[];
}

/** The canonical transaction protects every participating clip's owning track. */
export function clipGestureBlocked(project: { readonly tracks: readonly Track[] }, clipIds: readonly string[]): boolean {
	const participants = new Set(clipIds);
	return project.tracks.some(track => track.locked === true
		&& track.clipIds?.some(id => participants.has(id)));
}
