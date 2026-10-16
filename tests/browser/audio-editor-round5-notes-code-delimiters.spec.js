/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('Code preserves literal backticks through preview and its toggle removal', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['Recording notes']);
	const panel = editor.locator('[data-workspace-panel="recording-notes"]');
	const notes = panel.getByRole('textbox', { name: 'Recording notes', exact: true });
	const literal = 'echo `date`';
	await notes.fill(literal);
	await notes.press('ControlOrMeta+A');
	await panel.getByRole('button', { name: 'Code', exact: true }).click();
	await panel.getByRole('button', { name: 'Preview', exact: true }).click();
	const preview = panel.getByRole('region', { name: 'Recording notes preview', exact: true });
	await expect(preview.locator('code')).toHaveCount(1);
	await expect(preview.locator('code')).toHaveText(literal);
	await expect(preview).toHaveText(literal);
	await panel.getByRole('button', { name: 'Edit', exact: true }).click();
	await expect(notes).toBeFocused();
	await panel.getByRole('button', { name: 'Code', exact: true }).click();
	await expect(notes).toHaveValue(literal);
});
