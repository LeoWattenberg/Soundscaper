import {
	audacityActionDefinition,
	evaluateAudacityActionEnablement,
	isAudacityShortcutCommandDisabled,
	resolveAudacityActionHandler,
	resolveAudacityActionId,
} from '../audacity-action-parity.js';
import { audacityShortcutCommandUnassignable } from '../audacity-shortcut-command-inventory.ts';
import { normalizeAudioEditorShortcut } from '../preferences.js';
import { keyboardShortcutEventKey } from './keyboard-shortcut-key.ts';
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
	actionContext?: unknown;
	actionRuntime?: unknown;
	disabledActionIds?: readonly string[];
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

const NATIVE_CONTROL_KEYS = new Set([
	' ', 'arrowdown', 'arrowleft', 'arrowright', 'arrowup', 'end', 'enter', 'escape', 'home', 'tab',
]);
const NATIVE_EDITABLE_KEYS = new Set([
	'+', '-', '=', 'a', 'b', 'c', 'i', 'u', 'v', 'x', 'y', 'z',
	'backspace', 'delete', 'down', 'end', 'enter', 'home', 'left',
	'numpadenter', 'pagedown', 'pageup', 'right', 'tab', 'up',
]);

export function handleWorkspaceKeyboard(
	event: KeyboardEventLike,
	snapshot: ShortcutSnapshot,
	run: ShortcutRun,
	registry: ShortcutRegistry = {},
): void {
	if (event.defaultPrevented) return;
	if (isWorkspaceModalShortcutTarget(event.target)) return;
	const targetDisposition = workspaceShortcutTargetDisposition(event);
	if (targetDisposition === 'blocked') return;
	if (handleProjectZoomShortcut(event, snapshot, run, registry)) return;
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
	if (targetDisposition === 'modified-control' && resolveAudacityActionId(shortcutAction) === 'split-tool') return;
	const handler = shortcutAction ? resolveAudioEditorShortcutHandler(shortcutAction, registry) : null;
	if (handler) {
		run(handler);
		event.preventDefault();
	} else if (shortcutAction) {
		const canonicalActionId = resolveAudacityActionId(shortcutAction);
		if (audacityActionDefinition(canonicalActionId)
			|| findShortcutMenuHandler(registry.menus, canonicalActionId).matched) event.preventDefault();
	}
}

function workspaceShortcutTargetDisposition(
	event: Pick<KeyboardEventLike, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey' | 'target'>,
): 'allowed' | 'blocked' | 'modified-control' {
	if (typeof Element === 'undefined' || !(event.target instanceof Element)) return 'allowed';
	if (event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) {
		return isNativeEditableShortcut(event) ? 'blocked' : 'modified-control';
	}
	const control = event.target.closest('button, a, [role="menu"], [role="menubar"], [role="menuitem"], [role="toolbar"], [role="slider"], [role="spinbutton"]');
	if (!control) return 'allowed';
	if (event.ctrlKey || event.metaKey || event.altKey) return 'modified-control';
	if (control.closest('[role="menu"], [role="menubar"], [role="menuitem"]')) return 'blocked';
	return NATIVE_CONTROL_KEYS.has(event.key.toLowerCase()) ? 'blocked' : 'modified-control';
}

function isNativeEditableShortcut(
	event: Pick<KeyboardEventLike, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
): boolean {
	const key = keyboardShortcutEventKey(event).toLowerCase();
	if (event.altKey) return true;
	if (!event.ctrlKey && !event.metaKey && event.shiftKey && key === 'f10') return true;
	if (!event.ctrlKey && !event.metaKey) return !/^f(?:[1-9]|1\d|2[0-4])$/u.test(key);
	return NATIVE_EDITABLE_KEYS.has(key.replace(/^arrow/u, ''));
}

export function isWorkspaceModalShortcutTarget(target: EventTarget | null): boolean {
	const element = target as Element | null;
	if (typeof element?.closest !== 'function') return false;
	if (element.closest('[role="dialog"], [role="alertdialog"]') !== null) return true;
	const body = element.ownerDocument?.body;
	return typeof body?.querySelectorAll === 'function'
		&& [...body.querySelectorAll('[aria-modal="true"]')]
			.some((candidate) => ['dialog', 'alertdialog'].includes(candidate.getAttribute('role') || ''));
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
	snapshot: ShortcutSnapshot,
	run: ShortcutRun,
	registry: ShortcutRegistry = {},
): boolean {
	const zoomActionId = projectZoomShortcut(event);
	if (!zoomActionId) return false;
	const bindings = snapshot.preferences?.shortcuts?.[zoomActionId] || [];
	const normalizedEvent = normalizedProjectZoomEvent(event, zoomActionId);
	if (!bindings.some((binding) => matchesAudioEditorShortcutBinding(normalizedEvent, binding))) return false;
	const handler = resolveAudioEditorShortcutHandler(zoomActionId, registry);
	if (!handler) return false;
	event.preventDefault();
	run(handler);
	return true;
}

function normalizedProjectZoomEvent(event: KeyboardEventLike, actionId: string): KeyboardEventLike {
	if (actionId === 'zoom-in' && (event.key === '+' || event.code === 'NumpadAdd')) {
		return { ...event, code: 'Equal', key: '=', shiftKey: false };
	}
	if (actionId === 'zoom-out' && event.code === 'NumpadSubtract') {
		return { ...event, code: 'Minus', key: '-', shiftKey: false };
	}
	return event;
}

export function projectZoomShortcut(event: Pick<KeyboardEventLike, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey'>): string | null {
	if (event.altKey || (!event.ctrlKey && !event.metaKey)) return null;
	if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') return 'zoom-in';
	if (event.key === '-' || event.key === '_' || event.code === 'Minus' || event.code === 'NumpadSubtract') return 'zoom-out';
	return null;
}

export function matchAudioEditorShortcut(
	event: Pick<KeyboardEventLike, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
	shortcuts: Record<string, readonly string[]>,
): string | null {
	for (const [actionId, bindings] of Object.entries(shortcuts)) {
		if (bindings.some((candidate) => matchesAudioEditorShortcutBinding(event, candidate))) return actionId;
	}
	return null;
}

export function matchesAudioEditorShortcutBinding(
	event: Pick<KeyboardEventLike, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
	candidate: string,
): boolean {
	const eventKeyValue = keyboardShortcutEventKey(event);
	const eventKey = eventKeyValue === ' '
		? 'Space'
		: eventKeyValue.length === 1 ? eventKeyValue.toUpperCase() : eventKeyValue;
	const parts = normalizeAudioEditorShortcut(candidate).split('+');
	const configuredKey = parts.pop();
	const modifiers = new Set(parts);
	if (!configuredKey || normalizeAudioEditorShortcut(configuredKey).toLowerCase()
		!== normalizeAudioEditorShortcut(eventKey).toLowerCase()) return false;
	if (event.altKey !== modifiers.has('Alt') || event.shiftKey !== modifiers.has('Shift')) return false;
	const ctrl = modifiers.has('Ctrl');
	const meta = modifiers.has('Meta');
	if (ctrl && meta) return event.ctrlKey && event.metaKey;
	if (ctrl) return event.ctrlKey !== event.metaKey;
	if (meta) return event.metaKey && !event.ctrlKey;
	return !event.ctrlKey && !event.metaKey;
}

export function resolveAudioEditorShortcutHandler(
	actionId: string,
	{ actionContext, actionRuntime, disabledActionIds = [], menus = [] }: ShortcutRegistry = {},
): ShortcutHandler | null {
	const canonicalActionId = resolveAudacityActionId(actionId);
	if (audacityShortcutCommandUnassignable(canonicalActionId)
		|| audacityShortcutCommandUnassignable(actionId)) return null;
	if (isAudacityShortcutCommandDisabled(canonicalActionId, disabledActionIds)) return null;
	const definition = audacityActionDefinition(canonicalActionId);
	const enablementContext = actionContext ?? (
		actionRuntime && typeof actionRuntime === 'object'
		&& typeof (actionRuntime as { getActionContext?: unknown }).getActionContext === 'function'
			? actionRuntime
			: undefined
	);
	if (definition && enablementContext !== undefined
		&& !evaluateAudacityActionEnablement(canonicalActionId, enablementContext)) return null;
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
	return [...toolbar.querySelectorAll<HTMLElement>('button, select, input, [role="group"], [role="checkbox"]')].filter((element) => {
		// The vendored Checkbox marks a disabled box with a class rather than aria-disabled.
		if (element.matches(':disabled, [aria-disabled="true"], [role="checkbox"].checkbox--disabled')) return false;
		if (element.getAttribute('role') !== 'group' && element.closest('[role="group"]')) return false;
		return element.getClientRects().length > 0;
	});
}
