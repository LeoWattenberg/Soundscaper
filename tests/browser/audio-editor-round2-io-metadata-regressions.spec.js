/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeWorkspacePanel, importFiles, waitForEditor } from './audio-editor-test-helpers.js';

test('pasted multiline project comments retain their lines after saving and reopening', async ({ page }) => {
	let editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	let metadata = editor.locator('[data-workspace-panel="metadata"]');
	const comments = 'Take 1: keep the opening breath.\nTake 2: use the alternate ending.';
	await metadata.getByRole('textbox', { name: 'Comments', exact: true }).fill(comments);
	await metadata.getByRole('textbox', { name: 'Comments', exact: true }).press('Tab');
	await closeWorkspacePanel(editor, 'metadata');
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	metadata = editor.locator('[data-workspace-panel="metadata"]');
	await expect(metadata.getByRole('textbox', { name: 'Comments', exact: true })).toHaveValue(comments);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	editor = await waitForEditor(page);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	await expect(editor.locator('[data-workspace-panel="metadata"]')
		.getByRole('textbox', { name: 'Comments', exact: true })).toHaveValue(comments);
});
