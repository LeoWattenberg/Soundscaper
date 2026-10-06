/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Shift plus a vertical arrow on a media row extends its track selection', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const first = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row][1]')
		.getByRole('group', { name: 'Track 2, audio track', exact: true });
	await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'No tracks']);
	await first.focus();
	await page.keyboard.press('Enter');
	await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(1);
	await first.focus();
	await page.keyboard.press('Shift+ArrowDown');
	await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(2);
	await page.keyboard.press('Shift+ArrowUp');
	await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(1);
});
