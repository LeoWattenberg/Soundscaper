/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { recognizedShortcutKey } from '../src/common/editor/ui/shortcut-key-validation.ts';
import { shortcutEditorDraft } from '../src/common/editor/ui/dialogs/ShortcutEditorRow.tsx';
import { normalizeAudioEditorShortcut } from '../src/common/editor/audio-editor-shortcut-normalization.ts';
import { matchesAudioEditorShortcutBinding } from '../src/common/editor/ui/workspace-shortcuts.ts';

test('shortcut assignments reject misspelled key names', () => {
	for (const binding of ['Ctrl+Backspacee', 'Shift+LeftArrow', 'Ctrl+NumpadEntter']) {
		assert.equal(recognizedShortcutKey(binding), false, binding);
		assert.equal(shortcutEditorDraft({ shortcuts: {}, preferenceId: 'new-mono-track', bindings: [binding] }).invalid, true);
	}
});

test('shortcut key validation retains native names, aliases, mouse keys, and Unicode characters', () => {
	for (const binding of ['Ctrl+Backspace', 'Ctrl+arrowleft', 'Alt+Shift+Up', 'Ctrl+NUMPAD_ENTER',
		'Ctrl+Mouse4', 'Ctrl++', 'F24', 'Ctrl+é', 'Ctrl+ß', 'Ctrl+日', 'Ctrl+AudioVolumeDown', 'Ctrl+MediaPlayPause']) {
		assert.equal(recognizedShortcutKey(binding), true, binding);
	}
});

test('assigning a Unicode key retains one valid key through normalization and matching', () => {
	for (const key of ['ß', 'é', '日', '😀', 'e\u0301']) {
		const normalized = normalizeAudioEditorShortcut(key);
		assert.equal(recognizedShortcutKey(normalized), true, normalized);
		assert.equal(shortcutEditorDraft({ shortcuts: {}, preferenceId: 'new-label-track', bindings: [normalized] }).invalid, false);
		assert.equal(matchesAudioEditorShortcutBinding({ key, code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, normalized), true);
	}
	assert.equal(normalizeAudioEditorShortcut('ß'), 'ß');
	assert.equal(normalizeAudioEditorShortcut('Ctrl+e\u0301'), 'Ctrl+É');
});
