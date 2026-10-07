/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

registerAudioEditorHooks();

test('removing the last mastering sequence retains keyboard access to New sequence', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Tools', 'Mastering sequences');
	const dialog = page.getByRole('dialog', { name: 'Mastering sequences', exact: true });
	const add = dialog.getByRole('button', { name: 'New sequence', exact: true });
	await add.click();
	const remove = dialog.getByRole('button', { name: 'Remove sequence', exact: true });
	await remove.focus();
	await remove.press('Enter');
	await expect(remove).toHaveCount(0);
	await expect(add).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(remove).toBeVisible();
});

test('removing mastering entries focuses the next entry then Add region', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Window', 'Markers');
	await editor.getByRole('region', { name: 'Markers and named regions', exact: true })
		.getByRole('button', { name: 'Add region from selection', exact: true }).click();
	await chooseCommandAction(page, editor, 'Tools', 'Mastering sequences');
	const dialog = page.getByRole('dialog', { name: 'Mastering sequences', exact: true });
	await dialog.getByRole('button', { name: 'New sequence', exact: true }).click();
	const add = dialog.getByRole('button', { name: 'Add region', exact: true });
	await add.click();
	await add.click();
	const remove = dialog.getByRole('button', { name: 'Remove entry', exact: true });
	await expect(remove).toHaveCount(2);
	await remove.first().focus();
	await remove.first().press('Enter');
	await expect(remove).toHaveCount(1);
	await expect(remove).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(remove).toHaveCount(0);
	await expect(add).toBeFocused();
});
