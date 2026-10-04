/* SPDX-License-Identifier: AGPL-3.0-only */

/** An opening frame must preserve focus already handed to panel contents. */
export function focusOpenedWorkspacePanel(panel: HTMLElement | null): void {
	if (!panel || panel.contains(panel.ownerDocument.activeElement)) return;
	panel.tabIndex = -1;
	panel.focus({ preventScroll: false });
}
