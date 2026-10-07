/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('Framescaper refuses a reserved shuttle shortcut and executes a nonreserved replacement', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	const tracks = editor.locator('.audio-editor-track-row[data-track-id]');
	const originalTracks = await tracks.count();
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New mono track');
	const row = preferences.locator('[data-shortcut-action="new-mono-track"]');
	await row.getByRole('textbox').first().fill('J');
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await expect(row.getByRole('alert')).toContainText('Shuttle and edit points');
	await row.getByRole('textbox').first().fill('Ctrl+Alt+Shift+J');
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeEnabled();
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await editor.getByRole('button', { name: 'Undo', exact: true }).focus();
	await page.keyboard.press('Control+Alt+Shift+j');
	await expect(tracks).toHaveCount(originalTracks + 1);
});
