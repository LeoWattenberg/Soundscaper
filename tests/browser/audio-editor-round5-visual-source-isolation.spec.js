/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clickClipInterior } from './audio-editor-test-helpers.js';

test('editing the selected split Title preserves the other title text', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	const titles = editor.getByRole('group', { name: 'Video clip: Title', exact: true });
	await expect(titles).toHaveCount(1);
	const originalId = await titles.first().getAttribute('data-clip-id');
	await editor.getByRole('button', { name: 'Split tool', exact: true }).click();
	await clickClipInterior(page, titles.first(), 0.75);
	await expect(titles).toHaveCount(2);
	await expect(editor).toHaveAttribute('data-source-count', '1');
	await editor.getByRole('button', { name: 'Split tool', exact: true }).click();
	const original = editor.locator(`[data-clip-id="${originalId}"][role="group"]`);
	const duplicate = editor.locator(`[data-clip-id]:not([data-clip-id="${originalId}"])[role="group"]`);
	await duplicate.press('Enter');
	await openInspector(page, editor);
	let dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	const initial = await dialog.getByRole('textbox', { name: 'Text', exact: true }).inputValue();
	await dialog.getByRole('textbox', { name: 'Text', exact: true }).fill('Independent title');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.');
	await expect(editor).toHaveAttribute('data-source-count', '2');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await original.press('Enter');
	await openInspector(page, editor);
	dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	await expect(dialog.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue(initial);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-source-count', '1');
	await duplicate.press('Enter');
	await openInspector(page, editor);
	dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	await expect(dialog.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue(initial);
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-source-count', '2');
	await duplicate.press('Enter');
	await openInspector(page, editor);
	await expect(page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true })
		.getByRole('textbox', { name: 'Text', exact: true })).toHaveValue('Independent title');
});

async function openInspector(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', 'Selected Visual Inspector']);
}
