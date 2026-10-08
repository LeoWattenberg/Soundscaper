/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';

test('formatting a notes selection preserves surrounding whitespace and previews its emphasis', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseNestedCommandAction(page, editor, 'Window', ['Recording notes']);
	const panel = editor.locator('[data-workspace-panel="recording-notes"]');
	const notes = panel.getByRole('textbox', { name: 'Recording notes', exact: true });
	await notes.fill(' First take ');
	await notes.press('ControlOrMeta+A');
	await panel.getByRole('button', { name: 'Bold', exact: true }).click();
	await panel.getByRole('button', { name: 'Preview', exact: true }).click();
	const preview = panel.getByRole('region', { name: 'Recording notes preview', exact: true });
	await expect(preview.locator('strong')).toHaveText('First take');
	await expect(preview).toHaveText(' First take ');
	await panel.getByRole('button', { name: 'Edit', exact: true }).click();
	await expect(notes).toHaveValue(' **First take** ');
	await expect(notes).toBeFocused();
	await notes.press('ControlOrMeta+A');
	await panel.getByRole('button', { name: 'Bold', exact: true }).click();
	await expect(notes).toHaveValue(' First take ');
});
