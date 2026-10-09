/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('the open application menu releases configured modified navigation', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const command = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Ctrl+Alt+End');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await importFiles(editor, [monoTone]);
	await editor.getByRole('group', { name: 'Playhead', exact: true }).focus();
	await page.keyboard.press('Control+Alt+End');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	const editMenu = editor.getByRole('menuitem', { name: 'Edit', exact: true });
	await editMenu.press('Enter');
	const menu = editor.locator('.kw-audio-editor__application-menu[role="menu"]').first();
	const items = menu.locator(':scope > [role="menuitem"]:not([aria-disabled="true"])');
	const first = items.first();
	await expect(first).toBeFocused();
	await page.keyboard.press('End');
	await expect(items.last()).toBeFocused();
	await page.keyboard.press('Home');
	await expect(first).toBeFocused();
	await page.keyboard.press('Control+Alt+End');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await page.keyboard.press('Escape');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
});
