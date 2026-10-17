/* SPDX-License-Identifier: AGPL-3.0-only */
import type { KeyboardMapBinding } from './keyboard-map-model.ts';
import { keyboardMapState, keyboardMapStateLabel } from './keyboard-map-model.ts';
import type { KEYBOARD_MAP_COPY_BY_LOCALE } from '../../../i18n/editor-keyboard-map-copy.ts';

type Copy = Readonly<Record<keyof typeof KEYBOARD_MAP_COPY_BY_LOCALE.en, string>>;

/** Local focus commands use the same contexts as Audacity's keyboard map. */
export function keyboardMapContextBindings(copy: Copy, mac: boolean): KeyboardMapBinding[] {
	const rows: KeyboardMapBinding[] = [];
	const add = (context: 'clip' | 'edge' | 'fade', keys: readonly string[], action: string, modifiers: readonly string[] = []) => {
		const state = keyboardMapState(modifiers);
		keys.forEach(key => rows.push({ id: `context:${context}:${state}:${key}:${action}`, context: `context:${context}`, contextLabel: copy[context],
			key, action, state, text: `${state === 'plain' ? '' : keyboardMapStateLabel(state, mac, '') + (mac ? '' : '+')}${key}` }));
	};
	for (const context of ['clip', 'edge', 'fade'] as const) {
		for (const [key, action, atPlayhead] of [['F', copy.focusFades, copy.applyFade], ['T', copy.focusTrim, copy.applyTrim], ['S', copy.focusStretch, copy.applyStretch]]) {
			add(context, [key], action);
			add(context, [key], atPlayhead, ['Alt']);
		}
		add(context, ['F'], copy.fadesDialog, ['Alt', 'Shift']);
	}
	add('edge', ['Escape'], copy.clipFocus);
	add('fade', ['Escape'], copy.clipFocus);
	add('fade', ['Left', 'Right'], copy.fadeBoundary);
	add('fade', ['Left', 'Right'], copy.fadeBoundary, ['Shift']);
	add('fade', ['Up', 'Down'], copy.fadeCurve);
	add('fade', ['1', '2', '3', '4', '5'], copy.fadePreset);
	add('fade', ['0'], copy.fadeReset);
	add('fade', ['Delete'], copy.fadeRemove);
	add('fade', ['F10'], copy.fadeMenu, ['Shift']);
	add('fade', ['ContextMenu'], copy.fadeMenu);
	return rows;
}
