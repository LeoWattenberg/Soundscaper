/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { keyboardMapBindings, keyboardMapState } from '../src/common/editor/ui/dialogs/keyboard-map-model.ts';

const commands = [
	{ id: 'save', preferenceId: 'save-alias', label: 'Save', categoryId: 'file', categoryLabel: 'File', disabled: false },
	{ id: 'cut', label: 'Cut', categoryId: 'edit', categoryLabel: 'Edit', disabled: false },
	{ id: 'old', label: 'Unavailable', categoryId: 'file', categoryLabel: 'File', disabled: true },
];

test('keyboard map uses current configured bindings, aliases, removals and platform modifiers', () => {
	const shortcuts = { 'save-alias': ['Ctrl+Shift+S', 'Alt+F2'], cut: [], old: ['Ctrl+X'] };
	const windows = keyboardMapBindings(commands, shortcuts, false);
	assert.deepEqual(windows.map(row => [row.key, row.state]), [['S', 'Ctrl+Shift'], ['F2', 'Alt']]);
	const mac = keyboardMapBindings(commands, shortcuts, true);
	assert.equal(mac[0].state, 'Meta+Shift');
	assert.equal(mac[0].text, '⌘⇧S');
	assert.equal(keyboardMapBindings(commands, { save: ['Ctrl++'] }, false)[0].key, '+');
	assert.equal(keyboardMapState([]), 'plain');
});

test('keyboard map separates contextual handle keys from configured global shortcuts', async () => {
	const { keyboardMapContextBindings } = await import('../src/common/editor/ui/dialogs/keyboard-map-contexts.ts');
	const { KEYBOARD_MAP_COPY_BY_LOCALE } = await import('../src/common/i18n/editor-keyboard-map-copy.ts');
	const rows = keyboardMapContextBindings(KEYBOARD_MAP_COPY_BY_LOCALE.en, false);
	assert.ok(rows.some(row => row.context === 'context:fade' && row.key === '0' && row.action === 'Reset fade'));
	assert.ok(rows.some(row => row.context === 'context:fade' && row.key === 'F10' && row.state === 'Shift'));
	assert.ok(!rows.some(row => row.context === 'context:clip' && row.key === 'S' && row.state === 'Shift'));
	assert.ok(rows.some(row => row.context === 'context:edge' && row.key === 'S' && row.state === 'plain'));
	assert.ok(rows.some(row => row.context === 'context:edge' && row.key === 'S' && row.state === 'Alt'));
	assert.ok(!rows.some(row => row.key === 'S' && row.state === 'Shift'));
});
