import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
import { ContextMenuItem } from '@soundscaper/design-system/ContextMenuItem';
import { useAccessibilityProfile } from '@soundscaper/design-system/contexts/AccessibilityProfileContext';
import { useTheme } from '@soundscaper/design-system/ThemeProvider';
// This file renders .application-header* markup by class name without
// mounting the ApplicationHeader component, so its stylesheet must be
// imported explicitly or tree-shaking drops it with the unused module.
import '../../../../vendor/audacity-design-system/components/src/ApplicationHeader/ApplicationHeader.css';
import { getLocaleDescriptor } from '../../i18n/locales.js';
import { withBase } from '../../url';
import AudioEditorSearch from './AudioEditorSearch.jsx';
import AudioEditorWindowControls, { desktopChromeSupportsMenuAccessKeys } from './AudioEditorWindowControls.tsx';
import {
	createApplicationMenuAccessKeyController,
	resolveApplicationMenuAccessKeys,
} from './application-menu-access-key.ts';
import { materializeApplicationMenu } from './application-menu-materialization.ts';
import { AUDACITY_MENU_ORDER } from './application-menu-order.ts';

const applicationMarkLightSrc = withBase('/logo/logo-klein-schwarz.svg');
const applicationMarkDarkSrc = withBase('/logo/logo-klein-weiß.svg');
const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"]';
const DIRECT_MENU_ITEM_SELECTOR = ':scope > [role="menuitem"], :scope > [role="menuitemcheckbox"]';
const DIRECT_ENABLED_MENU_ITEM_SELECTOR = ':scope > [role="menuitem"]:not([aria-disabled="true"]), :scope > [role="menuitemcheckbox"]:not([aria-disabled="true"])';

export default function AudioEditorMenuBar({
	assistanceSearch = null,
	appName,
	copy,
	desktopChrome = null,
	locale,
	menus,
	onAssistanceSearchClose,
	onFullscreen,
	onSearchActivate,
	projectTabs,
	projectName,
	saveState,
	saveText,
	searchEntries = [],
}) {
	const { theme } = useTheme();
	const { activeProfile } = useAccessibilityProfile();
	const menuButtonsRef = useRef([]);
	const openMenuRef = useRef(null);
	const [accessKeys] = useState(() => createApplicationMenuAccessKeyController({
		focusFileMenu: () => undefined,
		openMenuByAccessKey: () => false,
	}));
	const [activeIndex, setActiveIndex] = useState(0);
	const [openMenu, setOpenMenu] = useState(null);
	openMenuRef.current = openMenu;
	const [searchOpen, setSearchOpen] = useState(false);
	const assistanceSearchRevisionRef = useRef(0);
	const orderedMenus = useMemo(() => AUDACITY_MENU_ORDER
		.map((id) => menus.find((menu) => menu.id === id))
		.filter(Boolean), [menus]);
	const menuAccessKeys = useMemo(() => resolveApplicationMenuAccessKeys(orderedMenus), [orderedMenus]);
	const menuAccessKeysById = useMemo(() => new Map(
		menuAccessKeys.map(({ key, menuId }) => [menuId, key]),
	), [menuAccessKeys]);
	const menuAccessKeysEnabled = desktopChromeSupportsMenuAccessKeys(desktopChrome?.platform);
	const flatNavigation = activeProfile.config.tabNavigation === 'sequential';
	const menuTabIndex = activeProfile.config.tabOrder?.['file-menu'] ?? 0;
	const horizontalRightDelta = getLocaleDescriptor(locale)?.direction === 'rtl' ? -1 : 1;

	const closeMenu = useCallback((restoreFocus = true) => {
		const current = openMenuRef.current;
		if (restoreFocus && current) {
			const trigger = menuButtonsRef.current[current.index];
			// Restore before an activated command can mount a modal. Its layout
			// effect then captures the stable menu trigger instead of document.body.
			trigger?.focus?.({ preventScroll: true });
			// A late frame must not reclaim focus from wherever a command, a dialog,
			// or the operator moved it; restore only while the document owns nothing.
			requestAnimationFrame(() => {
				const owner = trigger?.ownerDocument;
				const active = owner?.activeElement;
				if (!owner || (active && active !== owner.body && active !== owner.documentElement)) return;
				trigger?.focus?.({ preventScroll: true });
			});
		}
		openMenuRef.current = null;
		setOpenMenu(null);
	}, []);

	const openMenuAt = useCallback((index, { keyboard = false } = {}) => {
		const trigger = menuButtonsRef.current[index];
		if (!trigger) return;
		const rect = trigger.getBoundingClientRect();
		setSearchOpen(false);
		onAssistanceSearchClose?.();
		setActiveIndex(index);
		const menu = materializeApplicationMenu(orderedMenus[index]);
		setOpenMenu({
			id: menu.id,
			index,
			menu,
			x: rect.left,
			y: rect.bottom,
			autoFocus: keyboard,
		});
	}, [onAssistanceSearchClose, orderedMenus]);

	const onSearchOpenChange = useCallback((nextOpen) => {
		if (nextOpen) closeMenu(false);
		else onAssistanceSearchClose?.();
		setSearchOpen(nextOpen);
	}, [closeMenu, onAssistanceSearchClose]);

	useEffect(() => {
		const revision = assistanceSearch?.revision || 0;
		if (!revision || revision === assistanceSearchRevisionRef.current) return;
		assistanceSearchRevisionRef.current = revision;
		closeMenu(false);
		setSearchOpen(true);
	}, [assistanceSearch?.revision, closeMenu]);

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
	accessKeys.updateOptions({
		focusFileMenu: () => focusMenuButton(0, { open: false }),
		openMenuByAccessKey: (key) => {
			const match = menuAccessKeys.find((candidate) => candidate.key === key);
			if (!match) return false;
			const index = orderedMenus.findIndex((menu) => menu.id === match.menuId);
			if (index < 0) return false;
			openMenuAt(index, { keyboard: true });
			return true;
		},
	});

	useEffect(() => {
		if (!menuAccessKeysEnabled) return undefined;
		document.addEventListener('keydown', accessKeys.onKeyDown, true);
		document.addEventListener('keyup', accessKeys.onKeyUp, true);
		window.addEventListener('blur', accessKeys.cancel);
		return () => {
			document.removeEventListener('keydown', accessKeys.onKeyDown, true);
			document.removeEventListener('keyup', accessKeys.onKeyUp, true);
			window.removeEventListener('blur', accessKeys.cancel);
			accessKeys.cancel();
		};
	}, [accessKeys, menuAccessKeysEnabled]);

	useEffect(() => {
		if (!openMenu) return undefined;
		let observer;
		let semanticsFrame;
		const frame = requestAnimationFrame(() => {
			const root = document.querySelector('#kw-audio-editor-design-system .kw-audio-editor__application-menu[role="menu"]');
			root?.setAttribute('aria-label', openMenu.menu.label || copy.applicationMenu);
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
	}, [copy.applicationMenu, openMenu]);

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
		if (!openMenu || !(event.target instanceof Element)) return;
		const menu = event.target.closest('[role="menu"]');
		if (!menu?.closest('.kw-audio-editor__application-menu')) return;
		if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
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

	// The design system's ContextMenu also listens on `document` in the capture
	// phase. Claim application-menu navigation one level earlier so listener
	// registration timing cannot apply a key twice or swallow Tab.
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

	const style = {
		'--header-bg': theme.background.surface.default,
		'--header-border': theme.border.onSurface,
		'--header-text': theme.foreground.text.primary,
		'--header-menu-hover': theme.background.surface.hover,
	};
	const currentMenu = openMenu?.menu || null;

	return (
		<header
			className={`kw-audio-editor__application-header application-header application-header--windows${desktopChrome ? ' kw-audio-editor__application-header--desktop' : ''}`}
			data-desktop-chrome={desktopChrome ? 'true' : undefined}
			style={style}
		>
			<div className="application-header__windows-titlebar">
				<div className="application-header__windows-title">
					<img className="kw-audio-editor__application-mark kw-audio-editor__application-mark--light" src={applicationMarkLightSrc} alt="" aria-hidden="true" width="16" height="16" />
					<img className="kw-audio-editor__application-mark kw-audio-editor__application-mark--dark" src={applicationMarkDarkSrc} alt="" aria-hidden="true" width="16" height="16" />
					<span className="application-header__app-name">{projectName} — {appName}</span>
				</div>
				{projectTabs}
				<AudioEditorWindowControls
					desktopChrome={desktopChrome}
					fullscreenLabel={copy.fullscreen}
					onFullscreen={onFullscreen}
				/>
				<span className="kw-audio-editor-sr-only" data-save-state data-state={saveState}>{saveText}</span>
			</div>

			<div className="application-header__windows-menu-row" data-application-menu-row>
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
							aria-keyshortcuts={menuAccessKeysEnabled && menuAccessKeysById.has(menu.id)
								? `Alt+${menuAccessKeysById.get(menu.id).toUpperCase()}`
								: undefined}
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
				<AudioEditorSearch
					assistanceSearch={assistanceSearch}
					copy={copy}
					entries={searchEntries}
					locale={locale}
					onActivate={onSearchActivate}
					onOpenChange={onSearchOpenChange}
					open={searchOpen}
				/>
			</div>

			<span className="kw-audio-editor-sr-only" data-project-name>{projectName}</span>
			{currentMenu && (
				<div onClickCapture={onOpenMenuClickCapture}>
					<ContextMenu
						isOpen
						x={openMenu.x}
						y={openMenu.y}
						autoFocus={false}
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
	const activate = item.disabled || typeof item.onClick !== 'function' ? undefined : (...args) => {
		// The vendor item invokes onClose after its action. Close first so a
		// dialog opened by the action captures the top-level menu as its return target.
		closeMenu();
		return item.onClick(...args);
	};
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
			onClick={activate}
			onClose={() => closeMenu()}
		>
			{children}
		</ContextMenuItem>
	);
}
