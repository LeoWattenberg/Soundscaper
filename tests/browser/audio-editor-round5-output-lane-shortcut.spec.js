/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('output lane navigation preserves configured modified commands', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	for (let index = 0; index < 2; index += 1) {
		await editor.getByRole('button', { name: 'Add track', exact: true }).click();
		await page.locator('.add-track-flyout').getByRole('menuitem', { name: 'Send track', exact: true }).click();
	}
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const command = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Ctrl+Alt+Up');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const lanes = editor.locator('[data-output-lane][data-output-scope="send"]');
	await expect(lanes).toHaveCount(2);
	await lanes.last().focus();
	await lanes.last().press('ArrowUp');
	await expect(lanes.first()).toBeFocused();
	await lanes.first().press('ArrowDown');
	await expect(lanes.last()).toBeFocused();
	await lanes.last().press('Control+Alt+ArrowUp');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await expect(lanes.first()).not.toBeFocused();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
});
