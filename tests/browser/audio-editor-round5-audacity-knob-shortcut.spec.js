/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('a suspended modified command leaves the Audacity Reverb knob unchanged', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await row.getByRole('textbox').first().fill('Ctrl+Alt+Up');
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Delay and reverb', 'Reverb (Audacity)']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	const room = dialog.getByRole('group', { name: /^Room size(?: \(.*\))?$/u });
	const knob = room.getByRole('slider');
	await expect(knob).toHaveAttribute('aria-valuenow', '75');
	await knob.focus();
	await knob.press('Control+Alt+ArrowUp');
	await expect(knob).toHaveAttribute('aria-valuenow', '75');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await knob.press('ArrowDown');
	await expect(knob).toHaveAttribute('aria-valuenow', '74');
	await knob.press('Shift+ArrowDown');
	await expect(knob).toHaveAttribute('aria-valuenow', '64');
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const fader = editor.locator('.kw-audio-editor__mixer-channel--track').nth(1)
		.getByRole('slider', { name: /volume$/u });
	await fader.focus();
	await page.keyboard.press('Control+Alt+ArrowUp');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
});
