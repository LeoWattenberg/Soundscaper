/* SPDX-License-Identifier: AGPL-3.0-only */

import { workspacePanelRestoresCaptureFocus } from './workspace-product-panel-runtime.ts';

const FOCUS_ATTEMPTS = 4;

/**
 * A panel that closes or moves between docks unmounts the element the user
 * was interacting with, and React mounts its replacement a frame or two later.
 * Poll a few frames for the replacement before giving up rather than leaving
 * focus on the document body.
 */
function focusWhenMounted(ownerDocument, selector) {
	let attempts = FOCUS_ATTEMPTS;
	const restore = () => {
		const target = ownerDocument.querySelector(selector);
		if (target instanceof HTMLElement) {
			target.focus();
			return;
		}
		attempts -= 1;
		if (attempts > 0) requestAnimationFrame(restore);
	};
	requestAnimationFrame(restore);
}

export function closeWorkspacePanelAndRestoreFocus(ownerDocument, panelId, onTogglePanel) {
	onTogglePanel(panelId);
	if (!workspacePanelRestoresCaptureFocus(panelId)) return;
	focusWhenMounted(ownerDocument, '[data-transport="framescaper-record"] button');
}

/** After a dock change the panel re-mounts in another dock; follow it with focus. */
export function focusWorkspacePanelMenuButton(ownerDocument, panelId) {
	focusWhenMounted(ownerDocument, `[data-workspace-panel-menu="${panelId}"] button`);
}
