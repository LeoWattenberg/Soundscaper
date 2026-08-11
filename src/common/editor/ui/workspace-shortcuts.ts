import { resolveAudacityActionHandler, resolveAudacityActionId } from '../audacity-action-parity.js';
import { normalizeAudioEditorShortcut } from '../preferences.js';
import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';

type ShortcutHandler = () => unknown;
type ShortcutRun = (handler: ShortcutHandler) => unknown;

interface KeyboardEventLike {
	altKey: boolean;
	code: string;
	ctrlKey: boolean;
	defaultPrevented: boolean;
	key: string;
	metaKey: boolean;
	repeat?: boolean;
	shiftKey: boolean;
	target: EventTarget | null;
	preventDefault(): void;
}

interface ShortcutMenuItem {
	disabled?: boolean;
	divider?: boolean;
	id?: string;
	items?: readonly ShortcutMenuItem[];
	onClick?: ShortcutHandler;
	parityActionId?: string;
}

interface ShortcutRegistry {
	actionRuntime?: unknown;
	menus?: readonly ShortcutMenuItem[];
	videoNavigation?: Partial<Record<VideoNavigationShortcut, ShortcutHandler>>;
}

export type VideoNavigationShortcut = 'nextEdit' | 'previousEdit' | 'shuttleBackward' | 'shuttleForward' | 'shuttleStop';

interface ShortcutSnapshot {
	preferences?: {
		shortcuts?: Record<string, readonly string[]>;
	};
}

interface ShortcutMenuMatch {
	handler: ShortcutHandler | null;
	matched: boolean;
}

export function handleWorkspaceKeyboard(
	event: KeyboardEventLike,
	snapshot: ShortcutSnapshot,
	run: ShortcutRun,
	registry: ShortcutRegistry = {},
): void {
	if (event.defaultPrevented) return;
	if (handleProjectZoomShortcut(event, run, registry)) return;
	if (typeof Element !== 'undefined' && event.target instanceof Element && event.target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="menu"], [role="menubar"], [role="toolbar"], [role="slider"], [role="spinbutton"]')) return;
	const reservedVideoNavigationAction = registry.videoNavigation
		? videoNavigationShortcut({
			altKey: event.altKey,
			ctrlKey: event.ctrlKey,
			key: event.key,
			metaKey: event.metaKey,
			repeat: false,
			shiftKey: event.shiftKey,
		})
		: null;
	if (reservedVideoNavigationAction && event.repeat) return;
	const videoNavigationAction = videoNavigationShortcut(event);
	const videoNavigationHandler = videoNavigationAction ? registry.videoNavigation?.[videoNavigationAction] : null;
	if (reservedVideoNavigationAction) {
		if (videoNavigationHandler) {
			run(videoNavigationHandler);
			event.preventDefault();
		}
		return;
	}
	const shortcutAction = matchAudioEditorShortcut(event, snapshot.preferences?.shortcuts || {});
	const handler = shortcutAction ? resolveAudioEditorShortcutHandler(shortcutAction, registry) : null;
	if (handler) {
		run(handler);
		event.preventDefault();
	}
}

export function videoNavigationShortcut(
	event: Pick<KeyboardEventLike, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'repeat' | 'shiftKey'>,
): VideoNavigationShortcut | null {
	if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || event.shiftKey) return null;
	if (event.key === 'ArrowUp') return 'previousEdit';
	if (event.key === 'ArrowDown') return 'nextEdit';
	if (event.key.toUpperCase() === 'J') return 'shuttleBackward';
	if (event.key.toUpperCase() === 'K') return 'shuttleStop';
	if (event.key.toUpperCase() === 'L') return 'shuttleForward';
	return null;
}

export function handleProjectZoomShortcut(
	event: KeyboardEventLike,
	run: ShortcutRun,
	registry: ShortcutRegistry = {},
): boolean {
	const zoomActionId = projectZoomShortcut(event);
	if (!zoomActionId) return false;
	const handler = resolveAudioEditorShortcutHandler(zoomActionId, registry);
	if (!handler) return false;
	event.preventDefault();
	run(handler);
	return true;
}

export function projectZoomShortcut(event: Pick<KeyboardEventLike, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey'>): string | null {
	if (event.altKey || (!event.ctrlKey && !event.metaKey)) return null;
	if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') return 'zoom-in';
	if (event.key === '-' || event.key === '_' || event.code === 'Minus' || event.code === 'NumpadSubtract') return 'zoom-out';
	return null;
}

export function matchAudioEditorShortcut(
	event: Pick<KeyboardEventLike, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
	shortcuts: Record<string, readonly string[]>,
): string | null {
	const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
	const modifiers = [];
	if (event.ctrlKey || event.metaKey) modifiers.push('Ctrl');
	if (event.altKey) modifiers.push('Alt');
	if (event.shiftKey) modifiers.push('Shift');
	const binding = normalizeAudioEditorShortcut([...modifiers, key].join('+')).toLowerCase();
	for (const [actionId, bindings] of Object.entries(shortcuts)) {
		if (bindings.some((candidate) => normalizeAudioEditorShortcut(candidate).toLowerCase() === binding)) return actionId;
	}
	return null;
}

export function resolveAudioEditorShortcutHandler(
	actionId: string,
	{ actionRuntime, menus = [] }: ShortcutRegistry = {},
): ShortcutHandler | null {
	const canonicalActionId = resolveAudacityActionId(actionId);
	const menuMatch = findShortcutMenuHandler(menus, canonicalActionId);
	if (menuMatch.matched) return menuMatch.handler;
	const runtimeHandler: unknown = resolveAudacityActionHandler(canonicalActionId, actionRuntime);
	return typeof runtimeHandler === 'function' ? runtimeHandler as ShortcutHandler : null;
}

export function findShortcutMenuHandler(
	items: readonly ShortcutMenuItem[] | undefined,
	canonicalActionId: string,
): ShortcutMenuMatch {
	for (const item of items || []) {
		if (!item || item.divider) continue;
		const itemActionId = resolveAudacityActionId(item.parityActionId || item.id);
		if (itemActionId === canonicalActionId && !item.items?.length) {
			return {
				matched: true,
				handler: item.disabled || typeof item.onClick !== 'function' ? null : item.onClick,
			};
		}
		const childMatch = findShortcutMenuHandler(item.items, canonicalActionId);
		if (childMatch.matched) return childMatch;
	}
	return { matched: false, handler: null };
}

export function handleEditorToolbarKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
	if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
	const toolbar = event.currentTarget.querySelector('.toolbar[role="toolbar"]');
	if (!toolbar) return;
	const focusables = editorToolbarFocusables(toolbar);
	const current = focusables.findIndex((element) => element === document.activeElement || element.contains(document.activeElement));
	if (current < 0 || !focusables.length) return;
	event.preventDefault();
	event.stopPropagation();
	let next = current;
	if (event.key === 'Home') next = 0;
	else if (event.key === 'End') next = focusables.length - 1;
	else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % focusables.length;
	else next = (current - 1 + focusables.length) % focusables.length;
	const activeTabIndex = Math.max(0, Number.parseInt(focusables[current].getAttribute('tabindex') || '0', 10));
	focusables.forEach((element, index) => { element.tabIndex = index === next ? activeTabIndex : -1; });
	focusables[next].focus({ preventScroll: true });
	focusables[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function handleEditorToolbarFocus(event: ReactFocusEvent<HTMLElement>): void {
	const toolbar = event.currentTarget.querySelector('.toolbar[role="toolbar"]');
	if (!toolbar) return;
	const focusables = editorToolbarFocusables(toolbar);
	const current = focusables.findIndex((element) => element === event.target || element.contains(event.target));
	if (current < 0) return;
	const activeTabIndex = Math.max(0, ...focusables.map((element) => Number.parseInt(element.getAttribute('tabindex') || '-1', 10)));
	focusables.forEach((element, index) => { element.tabIndex = index === current ? activeTabIndex : -1; });
}

export function handleEditorToolbarBlur(event: ReactFocusEvent<HTMLElement>): void {
	if (event.currentTarget.contains(event.relatedTarget)) return;
	const toolbar = event.currentTarget.querySelector('.toolbar[role="toolbar"]');
	if (!toolbar) return;
	const focusables = editorToolbarFocusables(toolbar);
	const activeTabIndex = Math.max(0, ...focusables.map((element) => Number.parseInt(element.getAttribute('tabindex') || '-1', 10)));
	focusables.forEach((element, index) => { element.tabIndex = index === 0 ? activeTabIndex : -1; });
}

export function editorToolbarFocusables(toolbar: Element): HTMLElement[] {
	return [...toolbar.querySelectorAll<HTMLElement>('button, select, input, [role="group"]')].filter((element) => {
		if (element.matches(':disabled, [aria-disabled="true"]')) return false;
		if (element.getAttribute('role') !== 'group' && element.closest('[role="group"]')) return false;
		return element.getClientRects().length > 0;
	});
}
