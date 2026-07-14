import { useCallback, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
	AccessibilityProfileProvider,
	darkTheme,
	lightTheme,
	ThemeProvider,
	useTheme,
} from '@dilsonspickles/components';

const PORTAL_BODY_CLASS = 'kw-audio-editor-design-system-mounted';
const ACCESSIBILITY_STORAGE_KEY = 'audacity-accessibility-profile';
const ACCESSIBILITY_PROFILE_IDS = new Set(['au4-tab-groups', 'wcag-flat']);
let portalMountCount = 0;
let portalObserver = null;
let portalLayoutFrame = 0;

export function DesignSystemProviders({ children }) {
	const theme = useSiteTheme();
	const accessibilityProfile = useMemo(readAccessibilityProfile, []);
	usePortalSentinel();

	return (
		<AccessibilityProfileProvider initialProfileId={accessibilityProfile}>
			<ThemeProvider theme={theme === 'dark' ? darkTheme : lightTheme}>
				{children}
			</ThemeProvider>
		</AccessibilityProfileProvider>
	);
}

export function useAudioEditorSnapshot(controller) {
	return useSyncExternalStore(
		controller.subscribe,
		controller.getSnapshot,
		controller.getSnapshot,
	);
}

export function useAudioEditorTelemetry(controller) {
	return useSyncExternalStore(
		controller.subscribeTelemetry,
		controller.getTelemetrySnapshot,
		controller.getTelemetrySnapshot,
	);
}

// The component package consumes its theme as JavaScript rather than exposing
// a semantic CSS-variable sheet. Project the same active theme into the small
// set of variables used by editor-owned surfaces (canvas, timeline, and
// application layout), so those surfaces cannot drift into a second palette.
export function useAudioEditorThemeVariables() {
	const { theme } = useTheme();

	return useMemo(() => ({
		'--kw-editor-accent': theme.accent.primary,
		'--kw-editor-accent-strong': theme.background.control.button.primary.active,
		'--kw-editor-accent-soft': theme.semantic.info.backgroundSubtle,
		'--kw-editor-bg': theme.background.surface.default,
		'--kw-editor-panel': theme.background.surface.elevated,
		'--kw-editor-control': theme.background.control.input.idle,
		'--kw-editor-text': theme.foreground.text.primary,
		'--kw-editor-muted': theme.foreground.text.secondary,
		'--kw-editor-line': theme.border.onSurface,
		'--kw-editor-stage': theme.background.canvas.default,
		'--kw-editor-stage-raised': theme.background.surface.inset,
		'--kw-editor-stage-hover': theme.background.surface.hover,
		'--kw-editor-stage-line': theme.background.canvas.grid.major,
		'--kw-editor-stage-grid-major': theme.background.canvas.grid.major,
		'--kw-editor-stage-grid-minor': theme.background.canvas.grid.minor,
		'--kw-editor-stage-text': theme.foreground.text.contrastPrimary,
		'--kw-editor-stage-muted': theme.foreground.text.contrastSecondary,
		'--kw-editor-danger': theme.semantic.error.text,
		'--kw-editor-danger-bg': theme.semantic.error.backgroundSubtle,
		'--kw-editor-danger-line': theme.semantic.error.border,
		'--kw-editor-success': theme.semantic.success.text,
		'--kw-editor-success-bg': theme.semantic.success.backgroundSubtle,
		'--toolbar-bg': theme.background.toolbar,
		'--toolbar-border': theme.border.default,
		'--toolbar-divider': theme.border.divider,
		colorScheme: theme === darkTheme ? 'dark' : 'light',
	}), [theme]);
}

export function useElementSize() {
	const [element, setElement] = useState(null);
	const [size, setSize] = useState({ width: 1, height: 1 });
	const ref = useCallback((node) => setElement(node), []);

	useLayoutEffect(() => {
		if (!element) return undefined;
		const update = () => {
			const rect = element.getBoundingClientRect();
			setSize({
				width: Math.max(1, Math.round(rect.width)),
				height: Math.max(1, Math.round(rect.height)),
			});
		};
		update();
		if (typeof ResizeObserver !== 'function') {
			window.addEventListener('resize', update);
			return () => window.removeEventListener('resize', update);
		}
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, [element]);

	return [ref, size];
}

export function ActionBoundary({ name, children, className = '' }) {
	return (
		<span className={`audio-editor-action-boundary ${className}`} data-editor-action={name}>
			{children}
		</span>
	);
}

function useSiteTheme() {
	const readTheme = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
	const [theme, setTheme] = useState(readTheme);

	useEffect(() => {
		const observer = new MutationObserver(() => setTheme(readTheme()));
		observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		return () => observer.disconnect();
	}, []);

	return theme;
}

function usePortalSentinel() {
	useEffect(() => {
		portalMountCount += 1;
		document.body.classList.add(PORTAL_BODY_CLASS);
		if (portalMountCount === 1) startPortalRuntime();
		return () => {
			portalMountCount = Math.max(0, portalMountCount - 1);
			if (portalMountCount === 0) {
				stopPortalRuntime();
				document.body.classList.remove(PORTAL_BODY_CLASS);
			}
		};
	}, []);
}

function startPortalRuntime() {
	portalObserver = new MutationObserver(schedulePortalLayout);
	portalObserver.observe(document.body, { childList: true, subtree: true });
	window.addEventListener('resize', schedulePortalLayout);
	window.addEventListener('scroll', schedulePortalLayout, true);
	document.addEventListener('keydown', handlePortalKeyDown, true);
	schedulePortalLayout();
}

function stopPortalRuntime() {
	portalObserver?.disconnect();
	portalObserver = null;
	window.removeEventListener('resize', schedulePortalLayout);
	window.removeEventListener('scroll', schedulePortalLayout, true);
	document.removeEventListener('keydown', handlePortalKeyDown, true);
	if (portalLayoutFrame) cancelAnimationFrame(portalLayoutFrame);
	portalLayoutFrame = 0;
}

function schedulePortalLayout() {
	if (portalLayoutFrame) return;
	portalLayoutFrame = requestAnimationFrame(() => {
		portalLayoutFrame = 0;
		layoutDropdownPortals();
	});
}

// v0.9.0 positions Dropdown portals below the trigger without viewport
// collision handling. Keep the exact component, but project its body portal
// into a bounded, scrollable window and flip it above when space is tighter.
function layoutDropdownPortals() {
	const menus = document.querySelectorAll(`body.${PORTAL_BODY_CLASS} .dropdown__menu`);
	const triggers = [...document.querySelectorAll('#kw-audio-editor-design-system .dropdown__trigger[aria-expanded="true"]')];
	for (const [menuIndex, menu] of menus.entries()) {
		const trigger = nearestDropdownTrigger(menu, triggers);
		if (!trigger) continue;
		const rect = trigger.getBoundingClientRect();
		const margin = 8;
		const gap = 4;
		const naturalHeight = Math.min(240, Math.max(1, menu.scrollHeight));
		const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - margin);
		const spaceAbove = Math.max(0, rect.top - gap - margin);
		const openAbove = spaceBelow < Math.min(120, naturalHeight) && spaceAbove > spaceBelow;
		const availableHeight = Math.max(64, openAbove ? spaceAbove : spaceBelow);
		const height = Math.min(naturalHeight, availableHeight, 240);
		const width = Math.min(Math.max(rect.width, 120), Math.max(120, window.innerWidth - margin * 2));
		const left = Math.min(Math.max(margin, rect.left), Math.max(margin, window.innerWidth - margin - width));
		const top = openAbove
			? Math.max(margin, rect.top - gap - height)
			: Math.min(rect.bottom + gap, Math.max(margin, window.innerHeight - margin - height));

		menu.style.setProperty('top', `${Math.round(top)}px`, 'important');
		menu.style.setProperty('left', `${Math.round(left)}px`, 'important');
		menu.style.setProperty('width', `${Math.round(width)}px`, 'important');
		menu.style.setProperty('max-height', `${Math.round(height)}px`, 'important');
		menu.style.setProperty('overflow-y', 'auto', 'important');
		menu.setAttribute('aria-label', trigger.getAttribute('aria-label') || 'Options');
		menu.querySelectorAll('[role="option"]').forEach((option, optionIndex) => {
			if (!option.id) option.id = `kw-audio-editor-dropdown-${menuIndex}-${optionIndex}`;
		});
	}
}

function nearestDropdownTrigger(menu, triggers) {
	if (triggers.length < 2) return triggers[0] || null;
	const menuLeft = Number.parseFloat(menu.style.left) || 0;
	const menuWidth = Number.parseFloat(menu.style.width) || 0;
	return triggers.reduce((nearest, trigger) => {
		const rect = trigger.getBoundingClientRect();
		const distance = Math.abs(rect.left - menuLeft) + Math.abs(rect.width - menuWidth);
		return !nearest || distance < nearest.distance ? { trigger, distance } : nearest;
	}, null)?.trigger || null;
}

// The package moves focus into the body portal while its key handler remains
// attached to the non-ancestor trigger wrapper. Bridge listbox keys locally.
function handlePortalKeyDown(event) {
	const menu = event.target instanceof Element ? event.target.closest(`body.${PORTAL_BODY_CLASS} .dropdown__menu`) : null;
	if (!menu) return;
	const options = [...menu.querySelectorAll('[role="option"]')];
	if (!options.length) return;
	const currentIndex = Math.max(0, options.findIndex((option) => option.classList.contains('dropdown__option--hover')));
	if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
		event.preventDefault();
		const offset = event.key === 'ArrowDown' ? 1 : -1;
		const nextIndex = Math.max(0, Math.min(options.length - 1, currentIndex + offset));
		options.forEach((option, index) => option.classList.toggle('dropdown__option--hover', index === nextIndex));
		menu.setAttribute('aria-activedescendant', options[nextIndex].id);
		options[nextIndex].scrollIntoView({ block: 'nearest' });
		return;
	}
	if (event.key === 'Enter' || event.key === ' ') {
		event.preventDefault();
		options[currentIndex].click();
		return;
	}
	if (event.key === 'Escape') {
		event.preventDefault();
		const trigger = document.querySelector('#kw-audio-editor-design-system .dropdown__trigger[aria-expanded="true"]');
		trigger?.click();
		trigger?.focus();
	}
}

function readAccessibilityProfile() {
	try {
		const value = localStorage.getItem(ACCESSIBILITY_STORAGE_KEY);
		if (ACCESSIBILITY_PROFILE_IDS.has(value)) return value;
		if (value) localStorage.removeItem(ACCESSIBILITY_STORAGE_KEY);
	} catch {
		// The provider falls back to the Audacity tab-group profile below.
	}
	return 'au4-tab-groups';
}
