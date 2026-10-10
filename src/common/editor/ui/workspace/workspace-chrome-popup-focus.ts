/* SPDX-License-Identifier: AGPL-3.0-only */

/** A toolbar portal keeps the drawer that owns its expanded native trigger. */
export function workspaceChromeOwnsPopupFocus(panel: Element, target: Element): boolean {
	const popup = target.closest('[role="dialog"], [role="menu"], [role="listbox"]');
	const id = popup?.getAttribute('id');
	if (!id) return false;
	return Array.from(panel.querySelectorAll('[aria-expanded="true"]')).some(trigger =>
		trigger.getAttribute('aria-controls')?.split(/\s+/u).includes(id) === true);
}
