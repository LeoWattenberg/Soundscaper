/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FocusEvent, KeyboardEvent, MouseEvent } from 'react';

export function lightscaperMenuEvents(isCurrent: () => boolean) {
	const onKeyDown = (event: KeyboardEvent<HTMLDetailsElement>) => {
		if (!isCurrent() || event.key !== 'Escape' || !event.currentTarget.open) return;
		event.preventDefault(); event.stopPropagation();
		event.currentTarget.open = false;
		event.currentTarget.querySelector('summary')?.focus();
	};
	const onBlur = (event: FocusEvent<HTMLDetailsElement>) => {
		if (!isCurrent()) return;
		if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
			event.currentTarget.open = false;
		}
	};

	const closeMenu = (event: MouseEvent<HTMLButtonElement>) => {
		if (!isCurrent()) return false;
		const menu = event.currentTarget.closest<HTMLDetailsElement>('details[name="lightscaper-application-menu"]');
		if (menu) {
			menu.open = false;
			for (const submenu of menu.querySelectorAll<HTMLDetailsElement>('details[open]')) submenu.open = false;
		}
		menu?.querySelector('summary')?.focus(); return true;
	};
	return { closeMenu, onKeyDown, onBlur };
}
