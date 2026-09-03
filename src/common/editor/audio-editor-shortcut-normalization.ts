/* SPDX-License-Identifier: AGPL-3.0-only */

type ShortcutMap = Readonly<Record<string, readonly string[]>>;

export interface AudioEditorShortcutConflict {
	readonly binding: string;
	readonly actionIds: string[];
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
	const parts = value.split('+').map((part) => part.trim()).filter(Boolean);
	const key = parts.pop() || value;
	const modifiers = new Set(parts.map((part) => KEY_ALIASES.get(part.toLowerCase()) || part));
	const ordered = ['Ctrl', 'Meta', 'Alt', 'Shift'].filter((modifier) => modifiers.has(modifier));
	const normalizedKey = KEY_ALIASES.get(key.toLowerCase()) || (key.length === 1 ? key.toUpperCase() : key);
	return [...ordered, normalizedKey].join('+');
}

export function audioEditorShortcutConflictKey(binding: string): string {
	const parts = normalizeAudioEditorShortcut(binding).toLowerCase().split('+');
	const key = parts.pop() || '';
	const modifiers = new Set(parts);
	if (modifiers.has('ctrl') !== modifiers.has('meta')) {
		return ['primary', ...['alt', 'shift'].filter((modifier) => modifiers.has(modifier)), key].join('+');
	}
	return [...parts, key].join('+');
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
