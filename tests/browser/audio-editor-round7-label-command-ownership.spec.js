/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('a timeline label releases its assigned modified Delete command', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const command = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Ctrl+Alt+Delete');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await page.keyboard.press('Control+Alt+Delete');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await page.keyboard.press('Control+b');
	const input = editor.getByRole('textbox', { name: /^Edit labels:/u });
	await input.fill('Intro'); await input.press('Enter');
	const label = editor.locator('[data-label-id]');
	await label.focus(); await label.press('Delete');
	await expect(label).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(label).toHaveCount(1);
	await label.focus(); await page.keyboard.press('Control+Alt+Delete');
	await expect(editor.locator('[data-label-track]')).toHaveCount(2);
	await expect(label).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await expect(label).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(2);
	await expect(label).toHaveCount(1);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
