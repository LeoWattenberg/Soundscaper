/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('Bold preserves an ordinary wildcard reminder inside its completed emphasis', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['Recording notes']);
	const notes = editor.getByRole('textbox', { name: 'Recording notes', exact: true });
	const literal = 'Use *.wav files';
	await notes.fill(literal);
	await notes.selectText();
	await editor.getByRole('button', { name: 'Bold', exact: true }).click();
	await expect(notes).toHaveValue('**Use *.wav files**');
	await editor.getByRole('button', { name: 'Preview', exact: true }).click();
	const preview = editor.getByRole('region', { name: 'Recording notes preview', exact: true });
	await expect(preview.locator('strong')).toHaveText(literal);
	await expect(preview).toHaveText(literal);
	await editor.getByRole('button', { name: 'Edit', exact: true }).click();
	await editor.getByRole('button', { name: 'Bold', exact: true }).click();
	await expect(notes).toHaveValue(literal);
});
