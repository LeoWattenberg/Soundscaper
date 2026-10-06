/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';

test('Cancel stops generation before it publishes audio to the project', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const dialog = page.getByRole('dialog', { name: 'Tone', exact: true });
	const duration = dialog.getByRole('group', { name: 'Duration (seconds)', exact: true });
	await duration.locator('.timecode-digit').first().click();
	await page.keyboard.type('001000000');
	await page.keyboard.press('Enter');
	await expect(duration.locator('.timecode__display')).toHaveText('00h10m00.000s');
	await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(editor.locator('[data-editor-task-progress]')).toBeHidden({ timeout: 30_000 });
	await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
	await expect(editor).toHaveAttribute('data-clip-count', '0');
});
