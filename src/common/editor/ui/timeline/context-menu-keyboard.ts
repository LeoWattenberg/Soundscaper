/* SPDX-License-Identifier: AGPL-3.0-only */

export interface ContextMenuKeyboardEvent {
	readonly key: string;
	readonly shiftKey: boolean;
	readonly ctrlKey?: boolean;
	readonly metaKey?: boolean;
	readonly altKey?: boolean;
	readonly defaultPrevented?: boolean;
}

/** Native menu entry leaves modified and already-owned chords with their command. */
export function isContextMenuKey(event: ContextMenuKeyboardEvent): boolean {
	return !event.defaultPrevented && !event.ctrlKey && !event.metaKey && !event.altKey
		&& (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey));
}
