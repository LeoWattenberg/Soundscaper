/* SPDX-License-Identifier: AGPL-3.0-only */
import { audioEditorShortcutParts } from '../../audio-editor-shortcut-normalization.ts';

export interface KeyboardMapCommand {
	readonly id: string;
	readonly preferenceId?: string;
	readonly label: string;
	readonly categoryId: string;
	readonly categoryLabel: string;
	readonly disabled?: boolean;
}
export interface KeyboardMapBinding {
	readonly id: string;
	readonly action: string;
	readonly text: string;
	readonly key: string;
	readonly state: string;
	readonly context: string;
	readonly contextLabel: string;
}
const MODIFIERS = ['Ctrl', 'Meta', 'Alt', 'Shift'];
const MAC_GLYPHS: Readonly<Record<string, string>> = { Ctrl: '⌃', Meta: '⌘', Alt: '⌥', Shift: '⇧' };
export const keyboardMapState = (mods: readonly string[]) => MODIFIERS.filter(mod => mods.includes(mod)).join('+') || 'plain';
export const keyboardMapStateLabel = (state: string, mac: boolean, plain: string) => state === 'plain' ? plain
	: state.split('+').map(mod => mac ? MAC_GLYPHS[mod] : mod).join(mac ? '' : '+');

/** Read saved bindings instead of upstream's demo-only shortcut table. */
export function keyboardMapBindings(commands: readonly KeyboardMapCommand[], shortcuts: Readonly<Record<string, readonly string[]>>, mac: boolean): KeyboardMapBinding[] {
	return commands.filter(command => !command.disabled).flatMap(command => {
		const saved = shortcuts[command.id] ?? (command.preferenceId ? shortcuts[command.preferenceId] : undefined) ?? [];
		return saved.flatMap((text, index) => {
			try {
				const parts = audioEditorShortcutParts(text);
				if (/^Mouse\d+$/iu.test(parts.key)) return [];
				const modifiers = parts.modifiers.map(mod => mac && mod === 'Ctrl' && !parts.modifiers.includes('Meta') ? 'Meta' : mod);
				const state = keyboardMapState(modifiers);
				return [{ id: `${command.id}:${index}`, action: command.label, key: parts.key,
					text: `${state === 'plain' ? '' : keyboardMapStateLabel(state, mac, '') + (mac ? '' : '+')}${parts.key}`,
					state, context: command.categoryId, contextLabel: command.categoryLabel }];
			} catch { return []; }
		});
	});
}

export const KEYBOARD_MAP_ROWS: readonly (readonly string[])[] = [
	['Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
	['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace'],
	['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'],
	['CapsLock', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter'],
	['Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'Shift'],
	['Ctrl', 'Meta', 'Alt', 'Space', 'Alt', 'Meta', 'Left', 'Down', 'Up', 'Right'],
	['Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'ContextMenu'],
];
