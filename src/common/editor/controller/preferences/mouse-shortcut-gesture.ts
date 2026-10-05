/* SPDX-License-Identifier: AGPL-3.0-only */

import { mouseShortcutKey } from '../../mouse-shortcut.ts';

interface MouseShortcutReleaseEvent {
	readonly button: number;
	preventDefault(): void;
	stopPropagation(): void;
}

/** Keep the browser's release actions suppressed even when a command changes its context. */
export function createMouseShortcutGesture() {
	const claimedButtons = new Set<number>();
	const suppress = (event: MouseShortcutReleaseEvent): boolean => {
		if (!claimedButtons.has(event.button)) return false;
		event.preventDefault();
		event.stopPropagation();
		return true;
	};
	return {
		claim(button: number): void {
			if (mouseShortcutKey(button)) claimedButtons.add(button);
		},
		release(event: MouseShortcutReleaseEvent): boolean {
			// Auxiliary click follows mouseup and can carry its own default action.
			return suppress(event);
		},
		auxiliaryClick(event: MouseShortcutReleaseEvent): boolean {
			const consumed = suppress(event);
			claimedButtons.delete(event.button);
			return consumed;
		},
		forget(button: number): void {
			// A fresh down must replace claims whose auxiliary click never arrived.
			claimedButtons.delete(button);
		},
		dispose(): void {
			claimedButtons.clear();
		},
	};
}
