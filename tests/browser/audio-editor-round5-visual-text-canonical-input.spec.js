/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('ordinary accented Title text applies canonically and retains one Undo and Redo', async ({ page }) => {
	// Three inspector round trips retain the exact authored text and its history.
	test.setTimeout(60_000);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	const title = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	const dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	const text = dialog.getByRole('textbox', { name: 'Text', exact: true });
	async function openInspector() {
		await title.press('Enter');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
	}
	await openInspector();
	await text.fill('Café');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.');
	await text.fill('Cafe\u0301 recording');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.');
	await expect(text).toHaveValue('Café recording');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await openInspector();
	await expect(text).toHaveValue('Café');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await openInspector();
	await expect(text).toHaveValue('Café recording');
});
