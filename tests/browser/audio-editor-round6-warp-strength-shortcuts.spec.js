/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

for (const label of ['Quantization strength', 'Groove strength']) {
	test(`the native Audio warp ${label} keeps its draft during an assigned modified command`, async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
		await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
		const command = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
		await command.getByRole('textbox').first().fill('Ctrl+Alt+End');
		await command.getByRole('button', { name: 'Assign', exact: true }).click();
		await expect(command.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await clipByName(editor, monoTone.name).locator('.clip-header').click();
		await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
		const dialog = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
		if (label === 'Groove strength') await dialog.getByRole('checkbox', { name: 'Enable groove template', exact: true }).check();
		const strength = dialog.getByRole('slider', { name: new RegExp(`^${label}`, 'u') });
		await expect(strength).toHaveValue('50');
		await strength.press('ArrowRight');
		await expect(strength).toHaveValue('51');
		await strength.press('Control+Alt+End');
		await expect(strength).toHaveValue('51');
		await expect(editor.locator('[data-label-track]')).toHaveCount(0);
		await strength.press('Home');
		await expect(strength).toHaveValue('0');
		await strength.press('End');
		await expect(strength).toHaveValue('100');
		await strength.press('Shift+Home');
		await expect(strength).toHaveValue('0');
		await dialog.getByRole('button', { name: 'Close', exact: true }).click();
		await editor.getByRole('button', { name: 'Undo', exact: true }).focus();
		await page.keyboard.press('Control+Alt+End');
		await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	});
}
