/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForEditor } from './audio-editor-test-helpers.js';

test('deleting the active Framescaper custom workspace restores its supported video layout', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/en/');
	await expect(editor).toHaveAttribute('data-workspace-preset', 'video-editor');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Workspace$/u }).click();
	const preset = preferences.getByRole('button', { name: 'Workspace preset', exact: true });
	await preferences.getByRole('textbox', { name: 'Workspace name', exact: true }).fill('Picture review');
	await preferences.getByRole('button', { name: 'Create from current layout', exact: true }).click();
	await expect(preset).toHaveText(/Picture review/u);
	await preferences.getByRole('button', { name: 'Delete', exact: true }).click();
	await expect(editor).toHaveAttribute('data-workspace-preset', 'video-editor');
	await expect(preset).toHaveText(/Video editor/u);
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await page.reload();
	await expect(await waitForEditor(page)).toHaveAttribute('data-workspace-preset', 'video-editor');
});
