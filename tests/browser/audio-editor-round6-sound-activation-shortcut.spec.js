/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('the recording settings flyout releases its configured modified navigation command', async ({ page }) => {
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
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	const options = page.getByRole('dialog', { name: 'Record options', exact: true });
	await options.getByRole('button', { name: 'Sound activation', exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Sound activation', exact: true });
	const threshold = settings.getByRole('slider', { name: 'Activation threshold', exact: true });
	await threshold.focus();
	await page.keyboard.press('ArrowRight');
	await expect(threshold).toHaveValue('-39');
	await expect(threshold).toBeEnabled();
	await threshold.press('Control+Alt+End');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await expect(threshold).toHaveValue('-39');
	await threshold.press('Escape');
	await expect(settings).toBeHidden();
	await expect(options).toBeVisible();
});
