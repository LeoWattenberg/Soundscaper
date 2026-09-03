/* SPDX-License-Identifier: AGPL-3.0-only */

import { useLayoutEffect, useRef } from 'react';

import { DIRECT_ENABLED_MENU_ITEM_SELECTOR, MENU_ITEM_SELECTOR } from './application-menu-items.jsx';

/**
 * Keyboard and pointer handling for an open application menu. The design
 * system's ContextMenu also listens on `document` in the capture phase, so
 * navigation is claimed one level earlier, on `window`, and the event is
 * stopped so listener registration timing cannot apply a key twice or
 * swallow Tab.
 */
export function useApplicationMenuKeyboard({
	closeMenu,
	flatNavigation,
	focusMenuButton,
	horizontalRightDelta,
	menuButtonsRef,
	menuCount,
	openMenu,
	setActiveIndex,
	setOpenMenu,
}) {
	const onOpenMenuKeyDownCapture = (event) => {
		if (!openMenu || !(event.target instanceof Element)) return;
		const menu = event.target.closest('[role="menu"]');
		if (!menu?.closest('.kw-audio-editor__application-menu')) return;
		if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
			const items = Array.from(menu.querySelectorAll(DIRECT_ENABLED_MENU_ITEM_SELECTOR));
			if (!items.length) return;
			const currentIndex = items.indexOf(event.target);
			let nextIndex;
			if (event.key === 'Home') nextIndex = 0;
			else if (event.key === 'End') nextIndex = items.length - 1;
			else if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
			else nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
			event.preventDefault();
			event.stopImmediatePropagation();
			items[nextIndex]?.focus?.({ preventScroll: true });
			return;
		}
		const inSubmenu = Boolean(event.target.closest('.context-menu-submenu'));
		const submenuItem = event.target.closest('.context-menu-item');
		const hasSubmenu = Boolean(submenuItem?.querySelector(
			':scope > .context-menu-item-content .context-menu-item-arrow',
		));
		const opensSubmenu = !inSubmenu && hasSubmenu;
		if (!inSubmenu && event.key === 'Escape') {
			event.preventDefault();
			event.stopImmediatePropagation();
			closeMenu();
		} else if (!inSubmenu && !opensSubmenu && event.key === 'ArrowRight') {
			event.preventDefault();
			event.stopPropagation();
			focusMenuButton(openMenu.index + horizontalRightDelta, { open: true });
		} else if (!inSubmenu && event.key === 'ArrowLeft') {
			event.preventDefault();
			event.stopPropagation();
			focusMenuButton(openMenu.index - horizontalRightDelta, { open: true });
		} else if (hasSubmenu && ['ArrowRight', 'Enter'].includes(event.key)) {
			setTimeout(() => {
				setTimeout(() => {
					submenuItem?.querySelector(':scope > .context-menu-submenu')
						?.querySelector(MENU_ITEM_SELECTOR)?.focus?.({ preventScroll: true });
				}, 0);
			}, 0);
		} else if (event.key === 'Tab') {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation?.();
			const trigger = menuButtonsRef.current[openMenu.index];
			const nextMenuIndex = openMenu.index + 1;
			setOpenMenu(null);
			requestAnimationFrame(() => {
				if (event.shiftKey) {
					trigger?.focus?.({ preventScroll: true });
					return;
				}
				if (flatNavigation && nextMenuIndex < menuCount) {
					focusMenuButton(nextMenuIndex, { open: false });
					return;
				}
				if (!flatNavigation) setActiveIndex(0);
				const toolbarStop = document.querySelector(
					'#kw-audio-editor-design-system [data-editor-tool-toolbar] [tabindex]:not([tabindex="-1"]), '
					+ '#kw-audio-editor-design-system [data-editor-tool-toolbar] button:not([disabled])',
				);
				toolbarStop?.focus?.({ preventScroll: true });
			});
		}
	};

	const openMenuKeyDownRef = useRef(onOpenMenuKeyDownCapture);
	openMenuKeyDownRef.current = onOpenMenuKeyDownCapture;
	useLayoutEffect(() => {
		const handleKeyDownCapture = (event) => openMenuKeyDownRef.current(event);
		window.addEventListener('keydown', handleKeyDownCapture, true);
		return () => window.removeEventListener('keydown', handleKeyDownCapture, true);
	}, []);

	const onOpenMenuClickCapture = (event) => {
		if (!(event.target instanceof Element)) return;
		const item = event.target.closest('.context-menu-item');
		if (!item?.classList.contains('submenu-open')) return;
		if (!item.querySelector(':scope > .context-menu-item-content .context-menu-item-arrow')) return;
		// ContextMenuItem opens submenus on hover, then toggles them on click.
		// Keep an already-open submenu open so a normal pointer click is stable.
		event.preventDefault();
		event.stopPropagation();
		item.querySelector(':scope > .context-menu-submenu')?.querySelector(MENU_ITEM_SELECTOR)?.focus?.({ preventScroll: true });
	};

	return { onOpenMenuClickCapture };
}
