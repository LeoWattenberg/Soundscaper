/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

for (const kind of ['Fade in', 'Fade in shape']) test(`${kind} releases a configured Tab chord after ordinary traversal`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const command = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await command.getByRole('textbox').first().fill('Ctrl+Alt+Tab');
	await command.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const clip = clipByName(editor, toneA.name);
	await clip.focus();
	await clip.press('Enter');
	await clip.press('Tab');
	const fade = clip.getByRole('slider', { name: 'Fade in', exact: true });
	await expect(fade).toBeFocused();
	await page.keyboard.press('Tab');
	await expect(fade).not.toBeFocused();
	await clip.focus();
	await clip.press('Tab');
	await expect(fade).toBeFocused();
	if (kind === 'Fade in shape') {
		await fade.press('End');
		await expect(fade).toHaveAttribute('aria-valuenow', '0.8');
		await page.keyboard.press('Tab');
		await expect(clip.getByRole('slider', { name: kind, exact: true })).toBeFocused();
	}
	await page.keyboard.press('Control+Alt+Tab');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
});
