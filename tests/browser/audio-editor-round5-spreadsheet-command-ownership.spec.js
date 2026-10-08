/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('a docked spreadsheet retains an accepted unrelated project command outside a cell draft', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await row.getByRole('textbox').first().fill('Ctrl+Alt+L');
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
	const grid = editor.getByRole('grid', { name: 'Clip spreadsheet', exact: true });
	const cell = grid.locator('[data-row="0"][data-column="name"]');
	await cell.click();
	await cell.press('ArrowRight');
	await expect(grid.locator('[data-row="0"][data-column="track"]')).toBeFocused();
	await page.keyboard.press('ArrowLeft');
	await expect(cell).toBeFocused();
	await cell.press('F2');
	const draft = grid.getByRole('textbox', { name: 'Name', exact: true });
	await expect(draft).toBeFocused();
	await draft.press('Control+Alt+l');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await expect(draft).toBeFocused();
	await draft.press('Escape');
	await expect(cell).toBeFocused();
	await cell.press('Control+Alt+l');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
});
