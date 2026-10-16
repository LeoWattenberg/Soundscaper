/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('the source vertical ruler releases a configured modified context-menu chord', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const command = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Ctrl+Alt+Shift+F10');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const clip = clipByName(editor, monoTone.name);
	const properties = await openClipProperties(page, editor, clip);
	const ruler = properties.getByRole('region', { name: 'Source vertical ruler', exact: true });
	await ruler.focus();
	await page.keyboard.press('Shift+F10');
	await expect(page.getByRole('menuitem', { name: 'Waveform', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await ruler.focus();
	await page.keyboard.press('Control+Alt+Shift+F10');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await expect(page.getByRole('menuitem', { name: 'Waveform', exact: true })).toHaveCount(0);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
});
