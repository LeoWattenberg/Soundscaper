import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	ContextMenu,
	ContextMenuItem,
	useAccessibilityProfile,
	useTheme,
} from '@dilsonspickles/components';
import { getLocaleDescriptor } from '../../i18n/locales.js';
import { withBase } from '../../url';

const applicationMarkLightSrc = withBase('/logo/logo-klein-schwarz.svg');
const applicationMarkDarkSrc = withBase('/logo/logo-klein-weiß.svg');
const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"]';
const DIRECT_MENU_ITEM_SELECTOR = ':scope > [role="menuitem"], :scope > [role="menuitemcheckbox"]';
const DIRECT_ENABLED_MENU_ITEM_SELECTOR = ':scope > [role="menuitem"]:not([aria-disabled="true"]), :scope > [role="menuitemcheckbox"]:not([aria-disabled="true"])';

export const AUDACITY_MENU_ORDER = Object.freeze([
	'file',
	'edit',
	'select',
	'view',
	'tracks',
	'generate',
	'effect',
	'analyze',
	'tools',
	'extra',
	'project',
	'help',
]);

export default function AudioEditorMenuBar({
	appName,
	copy,
	locale,
	menus,
	onFullscreen,
	projectTabs,
	projectName,
	saveState,
	saveText,
}) {
	const { theme } = useTheme();
	const { activeProfile } = useAccessibilityProfile();
	const menuButtonsRef = useRef([]);
	const [activeIndex, setActiveIndex] = useState(0);
	const [openMenu, setOpenMenu] = useState(null);
	const menuOpen = Boolean(openMenu);
	const orderedMenus = useMemo(() => AUDACITY_MENU_ORDER
		.map((id) => menus.find((menu) => menu.id === id))
		.filter(Boolean), [menus]);
	const flatNavigation = activeProfile.config.tabNavigation === 'sequential';
	const menuTabIndex = activeProfile.config.tabOrder?.['file-menu'] ?? 0;
	const horizontalRightDelta = getLocaleDescriptor(locale)?.direction === 'rtl' ? -1 : 1;

	const closeMenu = useCallback((restoreFocus = true) => {
		setOpenMenu((current) => {
			if (restoreFocus && current) {
				requestAnimationFrame(() => menuButtonsRef.current[current.index]?.focus?.({ preventScroll: true }));
			}
			return null;
		});
	}, []);

	const openMenuAt = useCallback((index, { keyboard = false } = {}) => {
		const trigger = menuButtonsRef.current[index];
		if (!trigger) return;
		const rect = trigger.getBoundingClientRect();
		setActiveIndex(index);
		setOpenMenu({
			id: orderedMenus[index].id,
			index,
			x: rect.left,
			y: rect.bottom,
			autoFocus: keyboard,
		});
	}, [orderedMenus]);

	const focusMenuButton = useCallback((index, { open = Boolean(openMenu) } = {}) => {
		const count = orderedMenus.length;
		if (!count) return;
		const nextIndex = (index + count) % count;
		setActiveIndex(nextIndex);
		const button = menuButtonsRef.current[nextIndex];
		button?.focus?.({ preventScroll: true });
		button?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
		if (open) openMenuAt(nextIndex, { keyboard: true });
	}, [openMenu, openMenuAt, orderedMenus.length]);

	useEffect(() => {
		const focusFileMenu = (event) => {
			const plainF10 = event.key === 'F10'
				&& !event.shiftKey
				&& !event.altKey
				&& !event.ctrlKey
				&& !event.metaKey;
			const plainAlt = event.key === 'Alt' && !event.shiftKey && !event.ctrlKey && !event.metaKey;
			if (!plainF10 && !plainAlt) return;
			if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
			event.preventDefault();
			focusMenuButton(0, { open: false });
		};
		document.addEventListener('keydown', focusFileMenu, true);
		return () => document.removeEventListener('keydown', focusFileMenu, true);
	}, [focusMenuButton]);

	useEffect(() => {
		if (!menuOpen) return undefined;
		const navigateMenuItems = (event) => {
			if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
			const menu = event.target instanceof Element ? event.target.closest('[role="menu"]') : null;
			if (!menu?.closest('.kw-audio-editor__application-menu')) return;
			const items = Array.from(menu.querySelectorAll(DIRECT_ENABLED_MENU_ITEM_SELECTOR));
			if (!items.length) return;
			const currentIndex = items.indexOf(event.target);
			let nextIndex = currentIndex;
			if (event.key === 'Home') nextIndex = 0;
			else if (event.key === 'End') nextIndex = items.length - 1;
			else if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
			else nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
			event.preventDefault();
			event.stopImmediatePropagation();
			items[nextIndex]?.focus?.({ preventScroll: true });
		};
		document.addEventListener('keydown', navigateMenuItems, true);
		return () => document.removeEventListener('keydown', navigateMenuItems, true);
	}, [menuOpen]);

	useEffect(() => {
		if (!openMenu) return undefined;
		let observer;
		let semanticsFrame;
		const frame = requestAnimationFrame(() => {
			const root = document.querySelector('#kw-audio-editor-design-system .kw-audio-editor__application-menu[role="menu"]');
			root?.setAttribute('aria-label', orderedMenus[openMenu.index]?.label || copy.applicationMenu);
			const applyCheckedSemantics = () => {
				for (const marker of root?.querySelectorAll('[data-audio-editor-menu-checked]') || []) {
					const item = marker.closest(MENU_ITEM_SELECTOR);
					if (item?.getAttribute('role') !== 'menuitemcheckbox') item?.setAttribute('role', 'menuitemcheckbox');
					if (item?.getAttribute('aria-checked') !== marker.dataset.audioEditorMenuChecked) {
						item?.setAttribute('aria-checked', marker.dataset.audioEditorMenuChecked);
					}
				}
			};
			applyCheckedSemantics();
			if (root) {
				observer = new MutationObserver(() => {
					cancelAnimationFrame(semanticsFrame);
					semanticsFrame = requestAnimationFrame(applyCheckedSemantics);
				});
				observer.observe(root, {
					attributes: true,
					attributeFilter: ['role', 'data-audio-editor-menu-checked'],
					childList: true,
					subtree: true,
				});
			}
			if (!openMenu.autoFocus) return;
			const firstEnabled = root?.querySelector(DIRECT_ENABLED_MENU_ITEM_SELECTOR);
			(firstEnabled || root?.querySelector(DIRECT_MENU_ITEM_SELECTOR))?.focus?.({ preventScroll: true });
		});
		return () => {
			cancelAnimationFrame(frame);
			cancelAnimationFrame(semanticsFrame);
			observer?.disconnect();
		};
	}, [copy.applicationMenu, openMenu, orderedMenus]);

	const onTopLevelKeyDown = (event, index) => {
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			focusMenuButton(index + horizontalRightDelta);
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			focusMenuButton(index - horizontalRightDelta);
		} else if (event.key === 'Home') {
			event.preventDefault();
			focusMenuButton(0);
		} else if (event.key === 'End') {
			event.preventDefault();
			focusMenuButton(orderedMenus.length - 1);
		} else if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
			event.preventDefault();
			openMenuAt(index, { keyboard: true });
		} else if (event.key === 'Escape' && openMenu) {
			event.preventDefault();
			closeMenu();
		}
	};

	const onOpenMenuKeyDownCapture = (event) => {
		if (!openMenu) return;
		const inSubmenu = event.target instanceof Element && Boolean(event.target.closest('.context-menu-submenu'));
		const submenuItem = event.target instanceof Element ? event.target.closest('.context-menu-item') : null;
		const hasSubmenu = Boolean(submenuItem?.querySelector(
			':scope > .context-menu-item-content .context-menu-item-arrow',
		));
		const opensSubmenu = !inSubmenu && hasSubmenu;
		if (!inSubmenu && !opensSubmenu && event.key === 'ArrowRight') {
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
			const trigger = menuButtonsRef.current[openMenu.index];
			const nextMenuIndex = openMenu.index + 1;
			setOpenMenu(null);
			requestAnimationFrame(() => {
				if (event.shiftKey) {
					trigger?.focus?.({ preventScroll: true });
					return;
				}
				if (flatNavigation && nextMenuIndex < orderedMenus.length) {
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

	const style = {
		'--header-bg': theme.background.surface.default,
		'--header-border': theme.border.onSurface,
		'--header-text': theme.foreground.text.primary,
		'--header-menu-hover': theme.background.surface.hover,
	};
	const currentMenu = openMenu ? orderedMenus[openMenu.index] : null;

	return (
		<header className="kw-audio-editor__application-header application-header application-header--windows" style={style}>
			<div className="application-header__windows-titlebar">
				<div className="application-header__windows-title">
					<img className="kw-audio-editor__application-mark kw-audio-editor__application-mark--light" src={applicationMarkLightSrc} alt="" aria-hidden="true" width="16" height="16" />
					<img className="kw-audio-editor__application-mark kw-audio-editor__application-mark--dark" src={applicationMarkDarkSrc} alt="" aria-hidden="true" width="16" height="16" />
					<span className="application-header__app-name">{projectName} — {appName}</span>
				</div>
				{projectTabs}
				<button type="button" className="kw-audio-editor__fullscreen" aria-label={copy.fullscreen} title={copy.fullscreen} onClick={onFullscreen}>
					<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
						<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
					</svg>
				</button>
				<span className="kw-audio-editor-sr-only" data-save-state data-state={saveState}>{saveText}</span>
			</div>

			<div
				className="application-header__windows-menubar kw-audio-editor__menubar-scroll"
				role="menubar"
				aria-label={copy.applicationMenu}
				data-application-menubar
				onBlur={(event) => {
					if (flatNavigation || event.currentTarget.contains(event.relatedTarget)) return;
					if (event.relatedTarget instanceof Element && event.relatedTarget.closest('.kw-audio-editor__application-menu')) return;
					setActiveIndex(0);
				}}
			>
				{orderedMenus.map((menu, index) => (
					<button
						key={menu.id}
						ref={(element) => { menuButtonsRef.current[index] = element; }}
						type="button"
						className={`application-header__menu-item${openMenu?.index === index ? ' application-header__menu-item--open' : ''}`}
						role="menuitem"
						aria-haspopup="menu"
						aria-expanded={openMenu?.index === index}
						tabIndex={flatNavigation ? 0 : index === activeIndex ? menuTabIndex : -1}
						onFocus={() => setActiveIndex(index)}
						onMouseEnter={() => { if (openMenu) openMenuAt(index); }}
						onClick={() => openMenu?.index === index ? closeMenu(false) : openMenuAt(index)}
						onKeyDown={(event) => onTopLevelKeyDown(event, index)}
					>
						{menu.label}
					</button>
				))}
			</div>

			<span className="kw-audio-editor-sr-only" data-project-name>{projectName}</span>
			{currentMenu && (
				<div onClickCapture={onOpenMenuClickCapture} onKeyDownCapture={onOpenMenuKeyDownCapture}>
					<ContextMenu
						isOpen
						x={openMenu.x}
						y={openMenu.y}
						autoFocus={openMenu.autoFocus}
						onClose={() => closeMenu()}
						className="kw-audio-editor__application-menu"
					>
						{currentMenu.items.map((item, index) => renderMenuItem(item, `${currentMenu.id}-${index}`, closeMenu))}
					</ContextMenu>
				</div>
			)}
		</header>
	);
}

function renderMenuItem(item, key, closeMenu) {
	if (item.divider) return <ContextMenuItem key={key} isDivider />;
	const children = item.items?.map((child, index) => renderMenuItem(child, `${key}-${index}`, closeMenu));
	const plainLabel = item.disabledReason ? (
		<span title={item.disabledReason} data-disabled-reason={item.disabledReason}>
			{item.label}
			<span className="kw-audio-editor-sr-only"> — {item.disabledReason}</span>
		</span>
	) : item.label;
	const label = item.checked === undefined ? plainLabel : (
		<span data-audio-editor-menu-checked={item.checked ? 'true' : 'false'}>{plainLabel}</span>
	);
	return (
		<ContextMenuItem
			key={item.id || key}
			label={label}
			shortcut={item.shortcut}
			disabled={item.disabled}
			checked={item.checked}
			hasSubmenu={Boolean(children?.length)}
			onClick={item.disabled ? undefined : item.onClick}
			onClose={() => closeMenu()}
		>
			{children}
		</ContextMenuItem>
	);
}
