/* SPDX-License-Identifier: AGPL-3.0-only */

import { keyboardShortcutEventKey } from '../keyboard-shortcut-key.ts';

export const SPLIT_TOOL_HOLD_MILLISECONDS = 250;

interface SplitToolKeyEvent {
	readonly altKey: boolean;
	readonly code?: string;
	readonly ctrlKey: boolean;
	readonly key: string;
	readonly metaKey: boolean;
	readonly repeat?: boolean;
	readonly shiftKey: boolean;
	preventDefault(): void;
	stopPropagation(): void;
}

interface SplitToolShortcutLifecycleOptions {
	readonly bindings: readonly string[];
	readonly persistentEnabled: boolean;
	readonly onMomentaryChange: (enabled: boolean) => void;
	readonly onTogglePersistent: () => void;
	readonly schedule?: (callback: () => void, delay: number) => unknown;
	readonly cancelScheduled?: (handle: unknown) => void;
}

interface SplitToolShortcutListenerOptions extends SplitToolShortcutLifecycleOptions {
	readonly getPersistentEnabled: () => boolean;
	readonly getProjectOpen: () => boolean;
	readonly getRoot: () => Element | null;
}

export interface SplitToolShortcutLifecycle {
	handleKeyDown(event: SplitToolKeyEvent): boolean;
	handleKeyUp(event: SplitToolKeyEvent): boolean;
	handleBlur(): boolean;
	setPersistentEnabled(enabled: boolean): void;
	dispose(): void;
}

export interface SplitToolShortcutListenerRuntime {
	readonly lifecycle: SplitToolShortcutLifecycle;
	dispose(): void;
}

interface SplitToolPress {
	readonly keyIdentity: string;
	readonly held: boolean;
}

const MODIFIER_ALIASES = Object.freeze(new Map([
	['alt', 'alt'],
	['cmd', 'meta'],
	['command', 'meta'],
	['control', 'ctrl'],
	['ctrl', 'ctrl'],
	['meta', 'meta'],
	['option', 'alt'],
	['shift', 'shift'],
]));

const ALWAYS_EXCLUDED_TARGET_SELECTOR = [
	'input',
	'textarea',
	'select',
	'[contenteditable]:not([contenteditable="false"])',
	'[role="dialog"]',
	'[role="alertdialog"]',
	'[aria-modal="true"]',
	'[role="menu"]',
	'[role="menubar"]',
	'[role="menuitem"]',
].join(', ');
const CONTROL_TARGET_SELECTOR = [
	'button',
	'a',
	'[role="toolbar"]',
	'[role="slider"]',
	'[role="spinbutton"]',
].join(', ');
const MODAL_TARGET_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';
const NATIVE_CONTROL_KEYS = new Set([
	' ', 'arrowdown', 'arrowleft', 'arrowright', 'arrowup', 'end', 'enter', 'escape', 'home', 'tab',
]);

interface SplitToolShortcutTarget extends EventTarget {
	closest?(selector: string): Element | null;
	ownerDocument?: Pick<Document, 'body' | 'querySelectorAll'>;
}

/** Keep activation out of editing/menu contexts while allowing tool keys after toolbar clicks. */
export function isSplitToolShortcutTargetExcluded(
	target: EventTarget | null,
	event?: Pick<SplitToolKeyEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey'>,
): boolean {
	const candidate = target as SplitToolShortcutTarget | null;
	if (typeof candidate?.closest !== 'function') return false;
	if (candidate.closest(ALWAYS_EXCLUDED_TARGET_SELECTOR) !== null) return true;
	if (candidate.closest(CONTROL_TARGET_SELECTOR) !== null) {
		if (!event) return true;
		if (event.altKey || event.ctrlKey || event.metaKey) return false;
		return NATIVE_CONTROL_KEYS.has(event.key.toLowerCase());
	}
	return isSplitToolShortcutModalContext(candidate);
}

/** A modal suspends the editor tool context without treating ordinary controls as context loss. */
export function isSplitToolShortcutModalContext(target: EventTarget | null): boolean {
	const candidate = target as SplitToolShortcutTarget | null;
	if (typeof candidate?.closest !== 'function') return false;
	if (candidate.closest(MODAL_TARGET_SELECTOR) !== null) return true;
	const modalRoot = candidate.ownerDocument?.body ?? candidate.ownerDocument;
	return typeof modalRoot?.querySelectorAll === 'function'
		&& [...modalRoot.querySelectorAll('[aria-modal="true"]')].some((element) => (
			element.getAttribute('role') === 'dialog' || element.getAttribute('role') === 'alertdialog'
		));
}

/** Limit Split Tool's global listeners to the editor instance that owns the target. */
export function isSplitToolShortcutTargetWithinRoot(
	target: EventTarget | null,
	root: Element | null,
): boolean {
	if (target === null || root === null) return false;
	try {
		return root.contains(target as Node);
	} catch {
		return false;
	}
}

/** Match a configured chord without accepting unconfigured extra modifiers. */
export function matchesSplitToolShortcut(
	event: Pick<SplitToolKeyEvent, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
	bindings: readonly string[],
): boolean {
	return bindings.some((binding) => matchBinding(event, binding));
}

/**
 * Own the tap/hold state machine independently of React renders. A handled
 * key event is stopped here so the workspace's bubbling command dispatcher
 * cannot invoke the same shortcut as a one-shot action.
 */
export function createSplitToolShortcutLifecycle(
	options: SplitToolShortcutLifecycleOptions,
): SplitToolShortcutLifecycle {
	const schedule = options.schedule ?? ((callback: () => void, delay: number) => (
		globalThis.setTimeout(callback, delay)
	));
	const cancelScheduled = options.cancelScheduled ?? ((handle: unknown) => {
		globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>);
	});
	let persistentEnabled = options.persistentEnabled;
	let press: SplitToolPress | null = null;
	let holdHandle: unknown = null;

	const clearHold = (): void => {
		if (holdHandle === null) return;
		cancelScheduled(holdHandle);
		holdHandle = null;
	};
	const finishPress = (): SplitToolPress | null => {
		const finished = press;
		press = null;
		clearHold();
		if (finished) options.onMomentaryChange(false);
		return finished;
	};
	const togglePersistent = (): void => {
		persistentEnabled = !persistentEnabled;
		options.onTogglePersistent();
	};
	const consume = (event: SplitToolKeyEvent): true => {
		event.preventDefault();
		event.stopPropagation();
		return true;
	};
	const cancelPress = (): boolean => finishPress() !== null;
	const deactivate = (): boolean => {
		const hadPress = cancelPress();
		const wasPersistent = persistentEnabled;
		if (wasPersistent) togglePersistent();
		return hadPress || wasPersistent;
	};

	const handleKeyDown = (event: SplitToolKeyEvent): boolean => {
		if (event.key === 'Escape' && (press !== null || persistentEnabled)) {
			return deactivate() ? consume(event) : false;
		}

		if (press) {
			return keyIdentity(event) === press.keyIdentity ? consume(event) : false;
		}
		if (!matchesSplitToolShortcut(event, options.bindings)) return false;
		if (event.repeat) return consume(event);

		const startedPress: SplitToolPress = Object.freeze({
			keyIdentity: keyIdentity(event),
			held: false,
		});
		press = startedPress;
		options.onMomentaryChange(true);
		holdHandle = schedule(() => {
			holdHandle = null;
			if (press !== startedPress) return;
			press = Object.freeze({ ...startedPress, held: true });
		}, SPLIT_TOOL_HOLD_MILLISECONDS);
		return consume(event);
	};

	const handleKeyUp = (event: SplitToolKeyEvent): boolean => {
		if (!press || keyIdentity(event) !== press.keyIdentity) return false;
		const finished = finishPress();
		if (finished && !finished.held) togglePersistent();
		else if (finished?.held && persistentEnabled) togglePersistent();
		return consume(event);
	};

	return Object.freeze({
		handleKeyDown,
		handleKeyUp,
		handleBlur: deactivate,
		setPersistentEnabled: (enabled: boolean) => { persistentEnabled = enabled; },
		dispose: () => { cancelPress(); },
	});
}

/** Install the Split Tool's context-aware listeners behind its deferred feature boundary. */
export function installSplitToolShortcutListeners(
	options: SplitToolShortcutListenerOptions,
): SplitToolShortcutListenerRuntime {
	const lifecycle = createSplitToolShortcutLifecycle(options);
	const syncPersistent = (): void => lifecycle.setPersistentEnabled(options.getPersistentEnabled());
	const handleBlur = (): boolean => {
		syncPersistent();
		return lifecycle.handleBlur();
	};
	const keyDown = (event: KeyboardEvent): void => {
		syncPersistent();
		if (!options.getProjectOpen()) {
			handleBlur();
			return;
		}
		if (!isSplitToolShortcutTargetWithinRoot(event.target, options.getRoot())) return;
		if (isSplitToolShortcutTargetExcluded(event.target, event)) {
			if (event.key === 'Escape') handleBlur();
			return;
		}
		lifecycle.handleKeyDown(event);
	};
	const keyUp = (event: KeyboardEvent): void => {
		syncPersistent();
		if (!options.getProjectOpen()) {
			handleBlur();
			return;
		}
		lifecycle.handleKeyUp(event);
	};
	const focusIn = (event: FocusEvent): void => {
		if (
			!isSplitToolShortcutTargetWithinRoot(event.target, options.getRoot())
			|| isSplitToolShortcutModalContext(event.target)
		) handleBlur();
	};
	const focusOut = (event: FocusEvent): void => {
		if (!isSplitToolShortcutTargetWithinRoot(event.relatedTarget, options.getRoot())) handleBlur();
	};
	globalThis.addEventListener('keydown', keyDown, true);
	globalThis.addEventListener('keyup', keyUp, true);
	globalThis.addEventListener('focusin', focusIn, true);
	globalThis.addEventListener('focusout', focusOut, true);
	globalThis.addEventListener('blur', handleBlur);
	if (!options.getProjectOpen()) handleBlur();

	let disposed = false;
	return Object.freeze({
		lifecycle,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			globalThis.removeEventListener('keydown', keyDown, true);
			globalThis.removeEventListener('keyup', keyUp, true);
			globalThis.removeEventListener('focusin', focusIn, true);
			globalThis.removeEventListener('focusout', focusOut, true);
			globalThis.removeEventListener('blur', handleBlur);
			lifecycle.dispose();
		},
	});
}

function matchBinding(
	event: Pick<SplitToolKeyEvent, 'altKey' | 'code' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
	binding: string,
): boolean {
	const parts = binding.split('+').map((part) => part.trim()).filter(Boolean);
	const configuredKey = parts.pop();
	if (!configuredKey) return false;
	const modifiers = new Set<string>();
	for (const part of parts) {
		const modifier = MODIFIER_ALIASES.get(part.toLowerCase());
		if (!modifier) return false;
		modifiers.add(modifier);
	}
	if (event.altKey !== modifiers.has('alt') || event.shiftKey !== modifiers.has('shift')) return false;

	const ctrl = modifiers.has('ctrl');
	const meta = modifiers.has('meta');
	if (ctrl && meta) {
		if (!event.ctrlKey || !event.metaKey) return false;
	} else if (ctrl) {
		// Audacity's Ctrl spelling is the platform-primary modifier.
		if (event.ctrlKey === event.metaKey) return false;
	} else if (meta) {
		if (!event.metaKey || event.ctrlKey) return false;
	} else if (event.ctrlKey || event.metaKey) return false;

	return normalizedKey(configuredKey) === normalizedKey(keyboardShortcutEventKey(event));
}

function keyIdentity(event: Pick<SplitToolKeyEvent, 'code' | 'key'>): string {
	return event.code ? `code:${event.code.toLowerCase()}` : `key:${normalizedKey(event.key)}`;
}

function normalizedKey(key: string): string {
	if (key === ' ' || /^space(?:bar)?$/iu.test(key)) return 'space';
	if (/^numpad[_-]?enter$/iu.test(key)) return 'numpad-enter';
	const value = key.toLowerCase();
	if (value === 'esc' || value === 'escape') return 'escape';
	if (value === 'del' || value === 'delete') return 'delete';
	if (value === 'return' || value === 'enter') return 'enter';
	if (value.startsWith('arrow')) return value.slice('arrow'.length);
	return value;
}
