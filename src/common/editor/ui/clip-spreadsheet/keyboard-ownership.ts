/* SPDX-License-Identifier: AGPL-3.0-only */

interface SpreadsheetKey {
	readonly key: string;
	readonly code: string;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
}

const MODIFIED_GRID_KEYS = new Set([
	'a', 'c', 'v', 'x', 'z', 'y', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
	'Home', 'End', 'Tab', 'Enter', 'F2',
]);

export function spreadsheetOwnsKeyboard(event: SpreadsheetKey, drafting: boolean): boolean {
	if (drafting) return true;
	if (event.altKey) return false;
	if (!event.ctrlKey && !event.metaKey) return true;
	return event.code === 'Space' || MODIFIED_GRID_KEYS.has(event.key.length === 1 ? event.key.toLowerCase() : event.key);
}
