/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('formatting ordinary paragraphs preserves their empty separator without adding placeholder notes', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['Recording notes']);
	const notes = editor.getByRole('textbox', { name: 'Recording notes', exact: true });
	await notes.fill('First take\n\nSecond take');
	await notes.selectText();
	await editor.getByRole('button', { name: 'Numbered list', exact: true }).click();
	await expect(notes).toHaveValue('1. First take\n\n2. Second take');
	await editor.getByRole('button', { name: 'Preview', exact: true }).click();
	const preview = editor.getByRole('region', { name: 'Recording notes preview', exact: true });
	await expect(preview).not.toContainText('Numbered list');
	await expect(preview.getByRole('listitem')).toHaveCount(2);
	await editor.getByRole('button', { name: 'Edit', exact: true }).click();
	await notes.selectText();
	await editor.getByRole('button', { name: 'Numbered list', exact: true }).click();
	await expect(notes).toHaveValue('First take\n\nSecond take');
});
