/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('saved visual preset removal stays available without a selected generator and supports Undo', async ({ page }) => {
	test.setTimeout(60_000);
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	await editor.getByRole('group', { name: 'Video clip: Solid', exact: true }).press('Enter');
	const openPresets = async () => {
		await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Save Visual Preset']);
		return page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
	};
	let dialog = await openPresets();
	await dialog.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Old delivery look');
	await dialog.getByRole('button', { name: 'Save selected generator preset', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected visual preset saved.');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
	await chooseCommandAction(page, editor, 'Select', 'Select none');
	dialog = await openPresets();
	let picker = dialog.getByRole('combobox', { name: 'Saved visual preset', exact: true });
	await expect(picker).toBeEnabled();
	await expect(dialog.getByRole('button', { name: 'Save selected generator preset', exact: true })).toBeDisabled();
	await expect(dialog.getByRole('button', { name: 'Apply to selected generator', exact: true })).toBeDisabled();
	const removal = dialog.getByRole('button', { name: 'Remove visual preset', exact: true });
	await removal.focus();
	await removal.press('Enter');
	await expect(picker.getByRole('option', { name: 'Old delivery look', exact: true })).toHaveCount(0);
	await expect(picker).toBeFocused();
	await expect(removal).toBeDisabled();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	dialog = await openPresets();
	picker = dialog.getByRole('combobox', { name: 'Saved visual preset', exact: true });
	await expect(picker.getByRole('option', { name: 'Old delivery look', exact: true })).toHaveCount(1);
	await expect(dialog.getByRole('button', { name: 'Apply to selected generator', exact: true })).toBeDisabled();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	dialog = await openPresets();
	picker = dialog.getByRole('combobox', { name: 'Saved visual preset', exact: true });
	await expect(picker.getByRole('option', { name: 'Old delivery look', exact: true })).toHaveCount(0);
	await expect(dialog.getByRole('button', { name: 'Remove visual preset', exact: true })).toBeDisabled();
	await expect(picker).toBeEnabled();
});
