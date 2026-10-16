/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

test('a suspended modified shortcut leaves a Graphic EQ band unchanged', async ({ page }) => {
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
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Graphic EQ');
	const dialog = page.getByRole('dialog', { name: 'Graphic EQ', exact: true });
	const band = dialog.getByRole('slider', { name: '20 Hz', exact: true });
	await expect(band).toHaveAttribute('aria-valuenow', '0');
	await band.focus();
	await band.press('Control+Alt+ArrowUp');
	await expect(band).toHaveAttribute('aria-valuenow', '0');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const fader = editor.locator('.kw-audio-editor__mixer-channel--track').nth(1).getByRole('slider', { name: /volume$/u });
	await fader.focus();
	await page.keyboard.press('Control+Alt+ArrowUp');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
});
