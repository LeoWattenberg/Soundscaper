/* SPDX-License-Identifier: AGPL-3.0-only */

import { workspacePanelRestoresCaptureFocus } from './workspace-product-panel-runtime.ts';

export const FOCUS_ATTEMPTS = 30;

/**
 * A panel that closes or moves between docks unmounts the element the user
 * was interacting with, and React mounts its replacement a frame or two later.
 * Poll for the replacement before giving up rather than leaving focus on the
 * document body. The element the user was on is skipped: until React commits
 * the move it still matches the selector, and focusing it only hands focus to
 * the body when it unmounts a frame later.
 */
function focusWhenMounted(ownerDocument, selector, previous = null) {
	let attempts = FOCUS_ATTEMPTS;
	const restore = () => {
		const candidates = ownerDocument.querySelectorAll
			? [...ownerDocument.querySelectorAll(selector)]
			: [ownerDocument.querySelector(selector)];
		const target = candidates.find((candidate) => candidate instanceof HTMLElement && candidate !== previous);
		if (target) {
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

/**
 * After a dock change the panel re-mounts in another dock; follow it with
 * focus. `previous` is the menu button the change was made from, which is
 * about to unmount and must not be mistaken for its replacement.
 */
export function focusWorkspacePanelMenuButton(ownerDocument, panelId, previous = null) {
	focusWhenMounted(ownerDocument, `[data-workspace-panel-menu="${panelId}"] button`, previous);
}
