import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu } from '@soundscaper/design-system/ContextMenu';
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
import {
	DIRECT_ENABLED_MENU_ITEM_SELECTOR,
	DIRECT_MENU_ITEM_SELECTOR,
	MENU_ITEM_SELECTOR,
	renderApplicationMenuItem,
} from './application-menu-items.jsx';
import { useApplicationMenuKeyboard } from './useApplicationMenuKeyboard.js';
import WorkspaceChromeDrawer from './workspace/WorkspaceChromeDrawer.jsx';

const applicationMarkLightSrc = withBase('/logo/logo-klein-schwarz.svg');
const applicationMarkDarkSrc = withBase('/logo/logo-klein-weiß.svg');

export default function AudioEditorMenuBar({
	assistanceSearch = null,
	appName,
	chromeDrawer = /** @type {{isOpen: boolean, toggle: () => void, close: () => void} | null} */ (null),
	compact = false,
	compactBarSlot = /** @type {import('react').ReactNode} */ (null),
	copy,
	desktopChrome = null,
	drawerSlot = /** @type {import('react').ReactNode} */ (null),
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
	const compactBarRef = useRef(null);
	const drawerToggleRef = useRef(null);
	const drawerId = useId();
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
		// The compact layout shows the menu as a sheet under the compact bar
		// rather than beside its trigger inside the drawer.
		const anchor = compact && compactBarRef.current ? compactBarRef.current : trigger;
		const rect = anchor.getBoundingClientRect();
		setSearchOpen(false);
		onAssistanceSearchClose?.();
		setActiveIndex(index);
		const menu = materializeApplicationMenu(orderedMenus[index]);
		setOpenMenu({
			id: menu.id,
			index,
			menu,
			x: compact ? 8 : rect.left,
			y: compact ? rect.bottom + 4 : rect.bottom,
			autoFocus: keyboard,
		});
	}, [compact, onAssistanceSearchClose, orderedMenus]);

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
	useLayoutEffect(() => {
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
	}, [accessKeys, focusMenuButton, menuAccessKeys, openMenuAt, orderedMenus]);

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

	// The drawer lays the menubar out vertically, so Up/Down move between menus
	// there and Right opens one; the desktop row keeps the horizontal keys.
	const onTopLevelKeyDown = (event, index) => {
		const nextKey = compact ? 'ArrowDown' : 'ArrowRight';
		const previousKey = compact ? 'ArrowUp' : 'ArrowLeft';
		const step = compact ? 1 : horizontalRightDelta;
		const openKeys = compact ? ['ArrowRight', 'Enter', ' '] : ['ArrowDown', 'ArrowUp', 'Enter', ' '];
		if (event.key === nextKey) {
			event.preventDefault();
			focusMenuButton(index + step);
		} else if (event.key === previousKey) {
			event.preventDefault();
			focusMenuButton(index - step);
		} else if (event.key === 'Home') {
			event.preventDefault();
			focusMenuButton(0);
		} else if (event.key === 'End') {
			event.preventDefault();
			focusMenuButton(orderedMenus.length - 1);
		} else if (openKeys.includes(event.key)) {
			event.preventDefault();
			openMenuAt(index, { keyboard: true });
		} else if (event.key === 'Escape' && openMenu) {
			event.preventDefault();
			closeMenu();
		}
	};

	const { onOpenMenuClickCapture } = useApplicationMenuKeyboard({
		closeMenu,
		flatNavigation,
		focusMenuButton,
		horizontalRightDelta,
		menuButtonsRef,
		menuCount: orderedMenus.length,
		openMenu,
		setActiveIndex,
		setOpenMenu,
	});

	const style = {
		'--header-bg': theme.background.surface.default,
		'--header-border': theme.border.onSurface,
		'--header-text': theme.foreground.text.primary,
		'--header-menu-hover': theme.background.surface.hover,
	};
	const currentMenu = openMenu?.menu || null;
	const drawer = compact && chromeDrawer ? chromeDrawer : null;
	const search = (
		<AudioEditorSearch
			assistanceSearch={assistanceSearch}
			copy={copy}
			entries={searchEntries}
			locale={locale}
			onActivate={onSearchActivate}
			onOpenChange={onSearchOpenChange}
			open={searchOpen}
		/>
	);

	const menuRow = (
		<div className="application-header__windows-menu-row" data-application-menu-row>
			<div
				className="application-header__windows-menubar kw-audio-editor__menubar-scroll"
				role="menubar"
				aria-label={copy.applicationMenu}
				aria-orientation={compact ? 'vertical' : undefined}
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
			{!compact && search}
		</div>
	);

	return (
		<header
			className={`kw-audio-editor__application-header application-header application-header--windows${desktopChrome ? ' kw-audio-editor__application-header--desktop' : ''}`}
			data-desktop-chrome={desktopChrome ? 'true' : undefined}
			data-chrome-layout={compact ? 'compact' : 'desktop'}
			style={style}
		>
			<div
				ref={compactBarRef}
				className={`application-header__windows-titlebar${compact ? ' kw-audio-editor__compact-bar' : ''}`}
				data-compact-bar={compact ? 'true' : undefined}
			>
				{drawer && (
					<button
						ref={drawerToggleRef}
						type="button"
						className="kw-audio-editor__chrome-drawer-toggle"
						data-chrome-drawer-toggle
						aria-label={drawer.isOpen ? copy.chromeMenuClose : copy.chromeMenu}
						aria-expanded={drawer.isOpen}
						aria-controls={drawerId}
						onClick={() => drawer.toggle()}
					>
						<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
							<path d="M2 4h12M2 8h12M2 12h12" />
						</svg>
					</button>
				)}
				<div className="application-header__windows-title">
					<img className="kw-audio-editor__application-mark kw-audio-editor__application-mark--light" src={applicationMarkLightSrc} alt="" aria-hidden="true" width="16" height="16" />
					<img className="kw-audio-editor__application-mark kw-audio-editor__application-mark--dark" src={applicationMarkDarkSrc} alt="" aria-hidden="true" width="16" height="16" />
					<span className="application-header__app-name">{projectName}{!compact && <> — {appName}</>}</span>
				</div>
				{compact ? compactBarSlot : projectTabs}
				{compact && search}
				<AudioEditorWindowControls
					desktopChrome={desktopChrome}
					fullscreenLabel={copy.fullscreen}
					onFullscreen={onFullscreen}
				/>
				<span className="kw-audio-editor-sr-only" data-save-state data-state={saveState}>{saveText}</span>
			</div>

			{drawer ? (
				<WorkspaceChromeDrawer
					id={drawerId}
					open={drawer.isOpen}
					onClose={drawer.close}
					label={copy.chromeMenu}
					closeLabel={copy.chromeMenuClose}
					toggleRef={drawerToggleRef}
				>
					{menuRow}
					{projectTabs}
					{drawerSlot}
				</WorkspaceChromeDrawer>
			) : menuRow}

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
						{currentMenu.items.map((item, index) => renderApplicationMenuItem(
							item,
							`${currentMenu.id}-${index}`,
							{ closeMenu, onActivate: drawer ? drawer.close : null },
						))}
					</ContextMenu>
				</div>
			)}
		</header>
	);
}
