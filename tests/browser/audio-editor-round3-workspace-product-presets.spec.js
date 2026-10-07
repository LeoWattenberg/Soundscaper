/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForEditor } from './audio-editor-test-helpers.js';

for (const [path, expected] of [
	['/en/', ['Soundscaper', 'Audacity', 'Music', 'Classic']],
	['/framescaper/en/', ['Video editor']],
]) test(`${path} Preferences offers only supported presets and retains a saved custom layout`, async ({ page }) => {
	const editor = await bootEditor(page, path);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Workspace$/u }).click();
	const preset = preferences.getByRole('button', { name: 'Workspace preset', exact: true });
	await preset.click();
	const menu = page.getByRole('listbox', { name: 'Workspace preset', exact: true });
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('option')).toHaveText(expected);
	await page.keyboard.press('Escape');
	await preferences.getByRole('textbox', { name: 'Workspace name', exact: true }).fill('My layout');
	await preferences.getByRole('button', { name: 'Create from current layout', exact: true }).click();
	await expect(preset).toHaveText(/My layout/u);
	await expect(preferences.getByRole('textbox', { name: 'Workspace name', exact: true })).toHaveValue('');
	const customId = await editor.getAttribute('data-workspace-preset');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await page.reload();
	await expect(await waitForEditor(page)).toHaveAttribute('data-workspace-preset', customId);
});
