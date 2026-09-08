/* SPDX-License-Identifier: AGPL-3.0-only */

type ShortcutMap = Readonly<Record<string, readonly string[]>>;

export interface AudioEditorShortcutConflict {
	readonly binding: string;
	readonly actionIds: string[];
}

export interface AudioEditorShortcutParts {
	readonly key: string;
	readonly modifiers: readonly string[];
}

const KEY_ALIASES: ReadonlyMap<string, string> = new Map([
	['control', 'Ctrl'], ['ctrl', 'Ctrl'], ['cmd', 'Meta'], ['command', 'Meta'], ['meta', 'Meta'],
	['option', 'Alt'], ['alt', 'Alt'], ['shift', 'Shift'], ['spacebar', 'Space'], [' ', 'Space'],
	['arrowdown', 'Down'], ['arrowup', 'Up'], ['arrowleft', 'Left'], ['arrowright', 'Right'],
	['del', 'Delete'], ['esc', 'Escape'], ['return', 'Enter'],
	['pgup', 'PageUp'], ['pgdown', 'PageDown'], ['numpad_enter', 'NumpadEnter'],
	['numpad-enter', 'NumpadEnter'],
]);

export function normalizeAudioEditorShortcut(binding: string): string {
	if (typeof binding !== 'string' || !binding.trim()) {
		throw new TypeError('shortcut binding must be a non-empty string.');
	}
	const value = binding.trim();
	const { key, modifiers: parts } = splitShortcut(value);
	const modifiers = new Set(parts.map((part) => KEY_ALIASES.get(part.toLowerCase()) || part));
	const ordered = ['Ctrl', 'Meta', 'Alt', 'Shift'].filter((modifier) => modifiers.has(modifier));
	const normalizedKey = KEY_ALIASES.get(key.toLowerCase()) || (key.length === 1 ? key.toUpperCase() : key);
	return [...ordered, normalizedKey].join('+');
}

export function audioEditorShortcutParts(binding: string): AudioEditorShortcutParts {
	const normalized = normalizeAudioEditorShortcut(binding);
	const parts = splitShortcut(normalized);
	return Object.freeze({ key: parts.key, modifiers: Object.freeze(parts.modifiers) });
}

export function audioEditorShortcutConflictKey(binding: string): string {
	const parts = audioEditorShortcutParts(binding);
	const key = parts.key.toLowerCase();
	const modifiers = new Set(parts.modifiers.map((modifier) => modifier.toLowerCase()));
	if (modifiers.has('ctrl') !== modifiers.has('meta')) {
		return ['primary', ...['alt', 'shift'].filter((modifier) => modifiers.has(modifier)), key].join('+');
	}
	return [...modifiers, key].join('+');
}

function splitShortcut(value: string): { key: string; modifiers: string[] } {
	const plusKey = value.endsWith('+');
	const parts = (plusKey ? value.slice(0, -1) : value)
		.split('+')
		.map((part) => part.trim())
		.filter(Boolean);
	const key = plusKey ? '+' : parts.pop() || value;
	return { key, modifiers: parts };
}

export function collectAudioEditorShortcutConflicts(
	shortcuts: ShortcutMap,
	reservedShortcuts: ShortcutMap,
): AudioEditorShortcutConflict[] {
	const byBinding = new Map<string, AudioEditorShortcutConflict>();
	for (const [actionId, bindings] of Object.entries({ ...shortcuts, ...reservedShortcuts })) {
		for (const binding of bindings) {
			const key = audioEditorShortcutConflictKey(binding);
			if (!byBinding.has(key)) {
				byBinding.set(key, { binding: normalizeAudioEditorShortcut(binding), actionIds: [] });
			}
			const entry = byBinding.get(key)!;
			if (!entry.actionIds.includes(actionId)) entry.actionIds.push(actionId);
		}
	}
	return [...byBinding.values()].filter((entry) => entry.actionIds.length > 1);
}
