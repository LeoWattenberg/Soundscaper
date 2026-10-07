/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('configured modified navigation executes from the application menubar', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await row.getByRole('textbox').first().fill('Ctrl+Alt+Home');
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const menubar = editor.getByRole('menubar');
	const file = menubar.getByRole('menuitem', { name: 'File', exact: true });
	await file.focus();
	await file.press('Control+Alt+Home');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await expect(file).toBeFocused();
	await file.press('End');
	await expect(menubar.getByRole('menuitem', { name: 'Help', exact: true })).toBeFocused();
});
