/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('workspace deletion returns keyboard authoring to its preset picker', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await dialog.getByRole('tab', { name: /Workspace$/u }).click();
	await dialog.getByRole('textbox', { name: 'Workspace name', exact: true }).fill('Keyboard review');
	await dialog.getByRole('button', { name: 'Create from current layout', exact: true }).click();
	const preset = dialog.getByRole('button', { name: 'Workspace preset', exact: true });
	await expect(preset).toHaveText(/Keyboard review/u);
	const remove = dialog.getByRole('button', { name: 'Delete', exact: true });
	await remove.focus(); await remove.press('Enter');
	await expect(remove).toBeDisabled();
	await expect(preset).toBeFocused();
	await preset.press('Enter');
	await expect(page.getByRole('option', { name: 'Keyboard review', exact: true })).toHaveCount(0);
	await expect(page.getByRole('option', { name: 'Soundscaper', exact: true })).toBeVisible();
});
