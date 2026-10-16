/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

// Generator previews and preset persistence also run under precise Chromium coverage.
test.describe.configure({ timeout: 120_000 });

test('removing the selected visual preset clears its obsolete action target', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
	const clip = editor.getByRole('group', { name: 'Video clip: Solid', exact: true });
	await expect(clip).toBeVisible();
	await clip.press('Enter');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Save Visual Preset']);
	const dialog = page.getByRole('dialog', { name: 'Selected Visual Presets', exact: true });
	await dialog.getByRole('textbox', { name: 'Preset name', exact: true }).fill('My solid');
	await dialog.getByRole('button', { name: 'Save selected generator preset', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected visual preset saved.', { timeout: 30_000 });
	const presets = dialog.getByRole('combobox', { name: 'Saved visual preset', exact: true });
	await presets.selectOption({ label: 'My solid' });
	await dialog.getByRole('button', { name: 'Remove visual preset', exact: true }).click();
	await expect(dialog.getByRole('status')).toHaveText('Selected authored state removed.', { timeout: 30_000 });
	await expect(presets).toHaveValue('');
	await expect(dialog.getByRole('button', { name: 'Apply to selected generator', exact: true })).toBeDisabled();
	await expect(dialog.getByRole('button', { name: 'Remove visual preset', exact: true })).toBeDisabled();
});
