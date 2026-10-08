/* SPDX-License-Identifier: AGPL-3.0-only */

import { asymmetricStereoTone, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('a configured modified command leaves the stereo divider unchanged', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [asymmetricStereoTone]);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('radiogroup', { name: 'Asymmetric stereo heights', exact: true })
		.getByRole('radio', { name: 'Always', exact: true }).click();
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	await preferences.getByRole('searchbox', { name: 'Search commands', exact: true }).fill('New label track');
	const row = preferences.getByRole('group', { name: 'New label track', exact: true }).locator('..');
	await row.getByRole('textbox').first().fill('Ctrl+Alt+Up');
	await row.getByRole('button', { name: 'Assign', exact: true }).click();
	await expect(row.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const divider = editor.locator('[data-stereo-channel-divider]');
	await expect(divider).toHaveAttribute('aria-valuenow', '50');
	await divider.focus();
	await divider.press('Control+Alt+ArrowUp');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await expect(divider).toHaveAttribute('aria-valuenow', '50');
	await divider.press('ArrowUp');
	await expect(divider).toHaveAttribute('aria-valuenow', '45');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(divider).toHaveAttribute('aria-valuenow', '50');
	await expect(editor.locator('[data-label-track]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(divider).toHaveAttribute('aria-valuenow', '45');
});
