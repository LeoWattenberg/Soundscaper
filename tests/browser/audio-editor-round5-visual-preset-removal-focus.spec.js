/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

// Saving and removing authored state await project persistence before restoring focus.
test.describe.configure({ timeout: 120_000 });

test('removing visual presets keeps keyboard use in the surviving picker', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	await editor.getByRole('group', { name: 'Video clip: Solid', exact: true }).press('Enter');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Save Visual Preset']);
	const dialog = page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
	const picker = dialog.getByRole('combobox', { name: 'Saved visual preset', exact: true });
	for (const name of ['Keyboard first', 'Keyboard second']) {
		await dialog.getByRole('textbox', { name: 'Preset name', exact: true }).fill(name);
		await dialog.getByRole('button', { name: 'Save selected generator preset', exact: true }).click();
		await expect(dialog.getByRole('status')).toHaveText('Selected visual preset saved.', { timeout: 30_000 });
		await expect(picker.getByRole('option', { name, exact: true })).toHaveCount(1);
	}
	await picker.selectOption({ label: 'Keyboard first' });
	const removal = dialog.getByRole('button', { name: 'Remove visual preset', exact: true });
	await removal.focus();
	await removal.press('Enter');
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state removed.', { timeout: 30_000 });
	await expect(picker.getByRole('option', { name: 'Keyboard first', exact: true })).toHaveCount(0);
	await expect(picker).toBeFocused();
	await picker.press('Tab');
	await page.keyboard.press('Tab');
	await expect(removal).toBeFocused();
	await removal.press('Enter');
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state removed.', { timeout: 30_000 });
	await expect(picker.getByRole('option', { name: 'Keyboard second', exact: true })).toHaveCount(0);
	await expect(picker).toHaveValue('');
	await expect(removal).toBeDisabled();
	await expect(picker).toBeFocused();
});
