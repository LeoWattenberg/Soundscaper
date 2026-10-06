/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Select all tracks retains the effective time span of a header-selected clip', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Select', ['Tracks', 'Select all tracks']);
	await expect(editor.locator('[data-time-selection-overlay]')).toHaveCount(3);
	await expect(editor.getByRole('group', { name: 'Selection end', exact: true }).locator('.timecode__display'))
		.toHaveText('00h00m00.800s');
});
