/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles,
	openParametricEqSelectionEffect } from './audio-editor-test-helpers.js';

test('a suspended modified command leaves the parametric EQ band unchanged', async ({ page }) => {
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
	const dialog = await openParametricEqSelectionEffect(page, editor);
	const band = dialog.getByRole('application', { name: 'Parametric equalizer response', exact: true })
		.getByRole('button', { name: /^Band /u }).first();
	await expect(band).toBeEnabled();
	const before = await band.getAttribute('aria-label');
	await band.focus();
	await band.press('Control+Alt+ArrowUp');
	await expect(band).toHaveAttribute('aria-label', before);
	await band.press('ArrowUp');
	await expect(band).not.toHaveAttribute('aria-label', before);
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const fader = editor.locator('.kw-audio-editor__mixer-channel--track').nth(1)
		.getByRole('slider', { name: /volume$/u });
	await fader.focus();
	await page.keyboard.press('Control+Alt+ArrowUp');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
});
