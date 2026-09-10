import { useLayoutEffect, type RefObject } from 'react';

/** Keep format submenus usable for timers beside the bottom and right edges. */
export function useTimeCodeSubmenuPosition(container: RefObject<HTMLDivElement | null>, open: boolean): void {
	useLayoutEffect(() => {
		const menu = container.current?.querySelector<HTMLElement>('.context-menu');
		if (!open || !menu) return;
		const position = () => {
			for (const submenu of menu.querySelectorAll<HTMLElement>('.context-menu-submenu')) {
				const parent = submenu.parentElement;
				if (!parent) continue;
				Object.assign(submenu.style, {
					position: 'fixed', width: 'max-content', right: 'auto',
					maxWidth: `${Math.max(1, window.innerWidth - 20)}px`,
					maxHeight: `${Math.max(1, window.innerHeight - 20)}px`, overflowY: 'auto',
				});
				const anchor = parent.getBoundingClientRect();
				const bounds = submenu.getBoundingClientRect();
				const preferredLeft = anchor.right + bounds.width <= window.innerWidth - 10
					? anchor.right : anchor.left - bounds.width;
				submenu.style.left = `${Math.max(10, Math.min(preferredLeft, window.innerWidth - bounds.width - 10))}px`;
				submenu.style.top = `${Math.max(10, Math.min(anchor.top, window.innerHeight - bounds.height - 10))}px`;
			}
		};
		const observer = new MutationObserver(position);
		observer.observe(menu, { childList: true, subtree: true });
		window.addEventListener('resize', position);
		position();
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', position);
		};
	}, [container, open]);
}
