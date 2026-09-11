/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveEditorReturnFocus } from '../focus-restoration.ts';

/** Retain the menu identity across responsive header remounts while a dialog is open. */
export function captureNativeProcessingReturnFocus(document: Document | null): () => void {
	if (!document) return () => undefined;
	const menu = document.querySelector<HTMLElement>('[data-application-menubar] [role="menuitem"][aria-expanded="true"]');
	const original = menu ?? resolveEditorReturnFocus(document, document.activeElement);
	const label = menu?.textContent;
	return () => {
		const restore = (): void => {
			const matchingMenu = label ? [...document.querySelectorAll<HTMLElement>('[data-application-menubar] [role="menuitem"]')]
				.find((candidate) => candidate.textContent === label && candidate.getClientRects().length > 0) : null;
			const target = matchingMenu ?? (original?.isConnected ? original : null)
				?? document.querySelector<HTMLElement>('[data-chrome-drawer-toggle]')
				?? resolveEditorReturnFocus(document, null);
			target?.focus({ preventScroll: true });
		};
		if (document.defaultView?.requestAnimationFrame) document.defaultView.requestAnimationFrame(restore);
		else queueMicrotask(restore);
	};
}
