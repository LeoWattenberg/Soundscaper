/* SPDX-License-Identifier: AGPL-3.0-only */

interface KeyboardShortcutKeyEvent {
	readonly code?: string;
	readonly key: string;
	readonly shiftKey: boolean;
}

const UNSHIFTED_PRINTABLE_KEY_BY_CODE: Readonly<Record<string, string>> = Object.freeze({
	Backquote: '`',
	Digit0: '0',
	Digit1: '1',
	Digit2: '2',
	Digit3: '3',
	Digit4: '4',
	Digit5: '5',
	Digit6: '6',
	Digit7: '7',
	Digit8: '8',
	Digit9: '9',
	Minus: '-',
	Equal: '=',
	BracketLeft: '[',
	BracketRight: ']',
	Backslash: '\\',
	Semicolon: ';',
	Quote: "'",
	Comma: ',',
	Period: '.',
	Slash: '/',
});

/** Recover the base key named by a shortcut chord from a browser key event. */
export function keyboardShortcutEventKey(event: KeyboardShortcutKeyEvent): string {
	if (event.code === 'NumpadEnter') return 'NumpadEnter';
	if (!event.shiftKey) return event.key;
	return UNSHIFTED_PRINTABLE_KEY_BY_CODE[event.code ?? ''] ?? event.key;
}
