/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, waitForEditor } from './audio-editor-test-helpers.js';

test('sequence timing fields cancel drafts and commit one Enter edit through Undo and reload', async ({ page }) => {
	let editor = await bootEditor(page, '/framescaper/en/');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	let panel = editor.getByRole('tabpanel', { name: 'Sequence timing', exact: true });
	await editor.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
	let name = panel.getByRole('textbox', { name: 'Sequence name', exact: true });
	const original = await name.inputValue();
	await name.fill('Canceled sequence');
	await name.press('Escape');
	await name.press('Tab');
	await expect(name).toHaveValue(original);
	await name.fill('Saved sequence');
	await name.press('Enter');
	await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(name).toHaveValue(original);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(name).toHaveValue('Saved sequence');
	const timecode = panel.getByRole('textbox', { name: 'Start timecode', exact: true });
	const start = await timecode.inputValue();
	await timecode.fill('00:00:02:00');
	await timecode.press('Escape');
	await timecode.press('Tab');
	await expect(timecode).toHaveValue(start);
	await timecode.fill('00:00:01:00');
	await timecode.press('Enter');
	await expect(timecode).toHaveAttribute('data-sequence-start-timecode', '00:00:01:00');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(timecode).toHaveValue(start);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await page.reload();
	editor = await waitForEditor(page);
	await editor.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
	panel = editor.getByRole('tabpanel', { name: 'Sequence timing', exact: true });
	name = panel.getByRole('textbox', { name: 'Sequence name', exact: true });
	await expect(name).toHaveValue('Saved sequence');
	await expect(panel.getByRole('textbox', { name: 'Start timecode', exact: true })).toHaveValue(start);
});
