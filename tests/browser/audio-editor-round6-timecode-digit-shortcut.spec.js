/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('active time digits release a configured modified numeric chord', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const command = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Ctrl+1');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const playhead = editor.getByRole('group', { name: 'Playhead', exact: true });
	const display = playhead.locator('.timecode__display');
	const before = await display.textContent();
	await playhead.focus();
	await page.keyboard.press('Control+1');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	const digit = playhead.locator('.timecode-digit').last();
	await digit.click();
	await page.keyboard.press('ArrowUp');
	const edited = await display.textContent();
	expect(edited).not.toBe(before);
	await page.keyboard.press('ArrowDown');
	await expect(display).toHaveText(before);
	await page.keyboard.press('Control+1');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await expect(display).toHaveText(before);
	await page.keyboard.press('Enter');
	await expect(playhead).toBeFocused();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
});
