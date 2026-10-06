/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('Nyquist prompt restores the language together with the saved source', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
	await dialog.getByRole('combobox', { name: 'Language', exact: true }).selectOption('sal');
	await dialog.getByRole('textbox', { name: 'Nyquist source', exact: true }).fill('return 42');
	await dialog.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(dialog.locator('.kw-audio-editor__nyquist-output')).toContainText('42', { timeout: 20_000 });
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	await expect(dialog.getByRole('textbox', { name: 'Nyquist source', exact: true })).toHaveValue('return 42');
	await expect(dialog.getByRole('combobox', { name: 'Language', exact: true })).toHaveValue('sal');
	await dialog.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(dialog.locator('.kw-audio-editor__nyquist-output')).toContainText('42', { timeout: 20_000 });
});
