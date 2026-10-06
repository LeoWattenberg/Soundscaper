/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesAudioEditorShortcutBinding } from '../src/common/editor/ui/workspace-shortcuts.ts';

test('shortcut matching retains the typed shifted symbol and the supported base-key spelling', () => {
	const event = { key: '%', code: 'Digit5', ctrlKey: true, shiftKey: true, metaKey: false, altKey: false };
	assert.equal(matchesAudioEditorShortcutBinding(event, 'Ctrl+Shift+%'), true);
	assert.equal(matchesAudioEditorShortcutBinding(event, 'Ctrl+Shift+5'), true);
	assert.equal(matchesAudioEditorShortcutBinding({ ...event, shiftKey: false }, 'Ctrl+Shift+%'), false);
	assert.equal(matchesAudioEditorShortcutBinding(event, 'Ctrl+Shift+&'), false);
});

test('literal punctuation matching keeps modifier checks and ordinary named keys', () => {
	const event = { key: '?', code: 'Slash', ctrlKey: false, shiftKey: true, metaKey: false, altKey: false };
	assert.equal(matchesAudioEditorShortcutBinding(event, 'Shift+?'), true);
	assert.equal(matchesAudioEditorShortcutBinding(event, 'Shift+/'), true);
	assert.equal(matchesAudioEditorShortcutBinding(event, '?'), false);
	assert.equal(matchesAudioEditorShortcutBinding({ ...event, key: 'ArrowRight', code: 'ArrowRight', shiftKey: false }, 'Right'), true);
});
