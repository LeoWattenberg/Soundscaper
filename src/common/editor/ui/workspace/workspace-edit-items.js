/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The edit actions the tool toolbar and the workspace menus offer, with their
 * enablement derived from the current selection and clipboard.
 *
 * @param {{copy: Record<string, string>, editBlocked: boolean, editSelectionActive: boolean, hasClipboard: boolean, splitAvailable: boolean}} input
 */
export function createWorkspaceEditItems({ copy, editBlocked, editSelectionActive, hasClipboard, splitAvailable }) {
	const selectionDisabled = editBlocked || !editSelectionActive;
	return [
		{ action: 'cutPerTrackRipple', label: copy.cutPerTrackRipple, icon: 'cut', disabled: selectionDisabled },
		{ action: 'cutLeaveGap', label: copy.cutLeaveGap, icon: 'cut', disabled: selectionDisabled },
		{ action: 'cutAllTracksRipple', label: copy.cutAllTracksRipple, icon: 'cut', disabled: selectionDisabled },
		{ action: 'copy', label: copy.copy, icon: 'copy', disabled: selectionDisabled },
		{ action: 'paste', label: copy.paste, icon: 'paste', disabled: editBlocked || !hasClipboard },
		{ action: 'split', label: copy.split, icon: 'split', disabled: editBlocked || !splitAvailable },
		{ action: 'deletePerTrackRipple', label: copy.deletePerTrackRipple, icon: 'trash', disabled: selectionDisabled },
		{ action: 'deleteLeaveGap', label: copy.deleteLeaveGap, icon: 'trash', disabled: selectionDisabled },
		{ action: 'deleteAllTracksRipple', label: copy.deleteAllTracksRipple, icon: 'trash', disabled: selectionDisabled },
	];
}
