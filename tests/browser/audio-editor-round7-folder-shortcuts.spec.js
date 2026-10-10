/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('track folder navigation releases a configured modified project command', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const command = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Ctrl+Alt+Up');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseTrackMenuAction(page, editor, null, 'Move selection into new folder');
	const parent = editor.getByRole('treeitem', { name: 'Folder Folder 1, level 1', exact: true });
	for (let child = 0; child < 2; child += 1) {
		await parent.press('Shift+F10');
		await page.getByRole('menuitem', { name: 'New folder', exact: true }).click();
	}
	const first = editor.getByRole('treeitem', { name: 'Folder Folder 2, level 2', exact: true });
	const second = editor.getByRole('treeitem', { name: 'Folder Folder 3, level 2', exact: true });
	await second.press('ArrowUp');
	await expect(first).toBeFocused();
	await first.press('ArrowDown');
	await expect(second).toBeFocused();
	await second.press('Control+Alt+ArrowUp');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await expect(second).toHaveAttribute('aria-posinset', '2');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
});
