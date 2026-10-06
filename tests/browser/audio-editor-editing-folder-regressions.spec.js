/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, chooseCommandAction } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('Move selection into new folder wraps every selected track', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	const first = clipByName(editor, toneA.name);
	const second = clipByName(editor, toneB.name);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseTrackMenuAction(page, editor, first.locator('xpath=ancestor::div[@data-track-row][1]'),
		'Move selection into new folder');
	const folder = editor.locator('[data-track-folder-row]');
	await expect(folder).toHaveCount(1);
	await folder.focus();
	await folder.press('ArrowLeft');
	await expect(first).toHaveCount(0);
	await expect(second).toHaveCount(0);
});
