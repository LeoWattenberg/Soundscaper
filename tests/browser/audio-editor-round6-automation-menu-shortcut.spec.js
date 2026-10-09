/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('the automation curve menu releases configured modified navigation commands', async ({ page }) => {
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
	await importFiles(editor, [toneA]);
	const row = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, row, 'Add automation');
	const curve = row.locator('[data-automation-insert-point]').first();
	await curve.press('i');
	await curve.press('Shift+F10');
	const menu = row.getByRole('menu', { name: 'Automation curve', exact: true });
	const first = menu.getByRole('menuitemradio').first();
	await expect(first).toBeFocused();
	await first.press('End');
	await expect(menu.getByRole('menuitem', { name: 'Close', exact: true })).toBeFocused();
	await page.keyboard.press('Home');
	await expect(first).toBeFocused();
	await page.keyboard.press('Control+Alt+End');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await expect(row.locator('[data-automation-point-id]')).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
});
