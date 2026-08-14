/* SPDX-License-Identifier: AGPL-3.0-only */

interface TrackStructuralMenuCopy {
	readonly muteAllTracks: string;
	readonly unmuteAllTracks: string;
	readonly alignTracks: string;
	readonly alignEndToEnd: string;
	readonly alignTogether: string;
	readonly sortTracks: string;
	readonly sortByTime: string;
	readonly sortByName: string;
}

interface TrackStructuralMenuItem {
	readonly id: string;
	readonly label: string;
	readonly disabled?: boolean;
	readonly items?: readonly TrackStructuralMenuItem[];
}

export interface TrackStructuralMenuModel {
	readonly muteItems: readonly TrackStructuralMenuItem[];
	readonly alignMenu: TrackStructuralMenuItem;
	readonly sortMenu: TrackStructuralMenuItem;
}

/** Menu-only reachability model for atomic track structural operations. */
export function createTrackStructuralOperationMenuModel(options: Readonly<{
	copy: TrackStructuralMenuCopy;
	editingBlocked: boolean;
	hasTracks: boolean;
	hasAlignmentTarget: boolean;
}>): Readonly<TrackStructuralMenuModel> {
	const writeDisabled = options.editingBlocked || !options.hasTracks;
	const alignDisabled = writeDisabled || !options.hasAlignmentTarget;
	const leaf = (id: string, label: string, disabled: boolean): TrackStructuralMenuItem => (
		Object.freeze({ id, label, disabled })
	);
	return Object.freeze({
		// Mute all and unmute all act on the whole track collection, so the per-track
		// overflow menu is not a home for them and they carry no default shortcut: the
		// application menu is the only surface that makes them reachable.
		muteItems: Object.freeze([
			leaf('mute-all', options.copy.muteAllTracks, writeDisabled),
			leaf('unmute-all', options.copy.unmuteAllTracks, writeDisabled),
		]),
		alignMenu: Object.freeze({
			id: 'menu-align', label: options.copy.alignTracks,
			items: Object.freeze([
				leaf('align-end-to-end', options.copy.alignEndToEnd, alignDisabled),
				leaf('align-together', options.copy.alignTogether, alignDisabled),
				leaf('align-start-to-zero', 'Align start to zero', alignDisabled),
				leaf('align-start-to-playhead', 'Align start to playhead', alignDisabled),
				leaf('align-start-to-selection-end', 'Align start to selection end', alignDisabled),
				leaf('align-end-to-playhead', 'Align end to playhead', alignDisabled),
				leaf('align-end-to-selection-end', 'Align end to selection end', alignDisabled),
			]),
		}),
		sortMenu: Object.freeze({
			id: 'menu-sort', label: options.copy.sortTracks,
			items: Object.freeze([
				leaf('sort-by-time', options.copy.sortByTime, writeDisabled),
				leaf('sort-by-name', options.copy.sortByName, writeDisabled),
			]),
		}),
	});
}
