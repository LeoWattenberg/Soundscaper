/* SPDX-License-Identifier: AGPL-3.0-only */

/** Native dropdown portals keep the dialog authority of their actual trigger. */
export function portalDialogOwnsShortcuts(element: Element): boolean {
	const listbox = element.closest('[role="listbox"]');
	const identity = listbox?.getAttribute('id');
	const document = element.ownerDocument;
	if (!identity || typeof document?.querySelectorAll !== 'function') return false;
	return [...document.querySelectorAll('[aria-haspopup="listbox"][aria-controls]')].some(trigger => (
		(trigger.getAttribute('aria-controls') ?? '').split(/\s+/u).includes(identity)
		&& trigger.closest('[role="dialog"], [role="alertdialog"]') !== null
	));
}
