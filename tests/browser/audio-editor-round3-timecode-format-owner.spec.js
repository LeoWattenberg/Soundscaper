/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('opening a time-code format menu ends its preceding digit-key ownership', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const dialog = page.getByRole('dialog', { name: 'Tone', exact: true });
	const duration = dialog.getByRole('group', { name: 'Duration (seconds)', exact: true });
	const display = duration.locator('.timecode__display');
	const before = await display.textContent();
	await duration.locator('.timecode-digit').first().click();
	await duration.getByRole('button', { name: 'Duration (seconds): format', exact: true }).click();
	const choice = page.getByRole('menuitem', { name: 'dd:hh:mm:ss', exact: true });
	await expect(choice).toBeVisible();
	await page.keyboard.press('ArrowDown');
	await expect(display).toHaveText(before);
	await expect(choice).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(choice).toHaveCount(0);
	await expect(dialog).toBeVisible();
	await expect(display).toHaveText('00d00h00m30s');
});

test('a time digit editor leaves numeric typing to search after Ctrl K moves focus there', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const playhead = editor.getByRole('group', { name: 'Playhead', exact: true });
	const before = await playhead.locator('.timecode__display').textContent();
	await playhead.locator('.timecode-digit').first().click();
	await page.keyboard.press('Control+k');
	const search = editor.locator('[data-editor-search-input]');
	await expect(search).toBeFocused();
	await page.keyboard.type('1');
	await expect(search).toHaveValue('1');
	await expect(playhead.locator('.timecode__display')).toHaveText(before);
});
