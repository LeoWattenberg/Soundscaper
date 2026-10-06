/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Add label uses the effective range of a header-selected clip', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Edit', 'Add label');
	await editor.getByRole('textbox', { name: /^Edit labels:/u }).press('Enter');
	await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
	const panel = editor.locator('[data-workspace-panel="labels"]');
	await expect(panel.locator('.timecode__display').first()).toHaveText('00h00m00.000s');
	await expect(panel.locator('.timecode__display').nth(1)).toHaveText('00h00m00.800s');
});
