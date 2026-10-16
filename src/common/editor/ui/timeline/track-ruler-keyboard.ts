/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ContextMenuKeyboardEvent } from './context-menu-keyboard.ts';

interface TrackRulerKeyboardEvent extends ContextMenuKeyboardEvent {
	preventDefault(): void;
}

interface TrackRulerKeyboardActions {
	openMenu(): unknown;
	focusBefore(): unknown;
	focusAfter(): unknown;
	focusVertical(direction: 'up' | 'down'): unknown;
	focusTrack(): unknown;
}

/** Route the track ruler's existing menu and row traversal. */
export function handleTrackRulerKeyboard(event: TrackRulerKeyboardEvent, actions: TrackRulerKeyboardActions): void {
	if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
	if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
		actions.openMenu();
	} else if (event.key === 'Tab') {
		event.preventDefault();
		if (event.shiftKey) actions.focusBefore(); else actions.focusAfter();
	} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
		event.preventDefault();
		actions.focusVertical(event.key === 'ArrowDown' ? 'down' : 'up');
	} else if (event.key === 'Escape') {
		event.preventDefault();
		actions.focusTrack();
	}
}
