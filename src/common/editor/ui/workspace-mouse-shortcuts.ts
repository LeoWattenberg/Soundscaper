/* SPDX-License-Identifier: AGPL-3.0-only */

import { audacityActionDefinition, resolveAudacityActionId } from '../audacity-action-parity.js';
import { mouseShortcutKey, type MouseShortcutEvent } from '../mouse-shortcut.ts';
import {
	findShortcutMenuHandler,
	handleWorkspaceKeyboard,
	isWorkspaceModalShortcutTarget,
	matchAudioEditorShortcut,
	resolveAudioEditorShortcutHandler,
} from './workspace-shortcuts.ts';

type ShortcutSnapshot = Parameters<typeof handleWorkspaceKeyboard>[1];
type ShortcutRun = Parameters<typeof handleWorkspaceKeyboard>[2];
type ShortcutRegistry = NonNullable<Parameters<typeof handleWorkspaceKeyboard>[3]>;

interface WorkspaceMouseEvent extends MouseShortcutEvent {
	readonly defaultPrevented: boolean;
	readonly target: EventTarget | null;
	preventDefault(): void;
	stopPropagation(): void;
}

function workspaceMouseAction(event: MouseShortcutEvent, snapshot: ShortcutSnapshot, registry: ShortcutRegistry): string | null {
	const key = mouseShortcutKey(event.button);
	if (!key) return null;
	const action = matchAudioEditorShortcut({
		altKey: event.altKey, code: '', ctrlKey: event.ctrlKey, key,
		metaKey: event.metaKey, shiftKey: event.shiftKey,
	}, snapshot.preferences?.shortcuts || {});
	if (!action) return null;
	const canonicalId = resolveAudacityActionId(action);
	return audacityActionDefinition(canonicalId) || findShortcutMenuHandler(registry.menus, canonicalId).matched
		? action : null;
}

export function handleWorkspaceMouseDown(
	event: WorkspaceMouseEvent,
	snapshot: ShortcutSnapshot,
	run: ShortcutRun,
	registry: ShortcutRegistry = {},
	onClaim?: (button: number) => void,
): void {
	if (event.defaultPrevented || isWorkspaceModalShortcutTarget(event.target)) return;
	const action = workspaceMouseAction(event, snapshot, registry);
	if (!action) return;
	event.preventDefault();
	event.stopPropagation();
	onClaim?.(event.button);
	const handler = resolveAudioEditorShortcutHandler(action, registry);
	if (handler) run(handler);
}

/** Preserve the compatibility mousedown while shielding child pointer handlers. */
export function blockWorkspaceMouseShortcutPointer(
	event: WorkspaceMouseEvent,
	snapshot: ShortcutSnapshot,
	registry: ShortcutRegistry = {},
): void {
	if (event.defaultPrevented || isWorkspaceModalShortcutTarget(event.target)) return;
	if (workspaceMouseAction(event, snapshot, registry)) event.stopPropagation();
}
