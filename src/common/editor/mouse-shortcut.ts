/* SPDX-License-Identifier: AGPL-3.0-only */

export interface MouseShortcutEvent {
	readonly button: number;
	readonly altKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly shiftKey: boolean;
}

/** Button numbers are zero-based; reserve the three standard mouse buttons. */
export function mouseShortcutKey(button: number): string | null {
	return Number.isSafeInteger(button) && button >= 3 && button < Number.MAX_SAFE_INTEGER
		? `Mouse${button + 1}`
		: null;
}

export function mouseShortcutBinding(event: MouseShortcutEvent): string | null {
	const key = mouseShortcutKey(event.button);
	if (!key) return null;
	return [
		...(event.ctrlKey ? ['Ctrl'] : []),
		...(event.metaKey ? ['Meta'] : []),
		...(event.altKey ? ['Alt'] : []),
		...(event.shiftKey ? ['Shift'] : []),
		key,
	].join('+');
}
