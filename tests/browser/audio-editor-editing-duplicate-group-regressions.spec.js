/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('duplicating a grouped track creates independent clip groups', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	const first = clipByName(editor, toneA.name);
	const second = clipByName(editor, toneB.name);
	await first.locator('.clip-header').click();
	await second.locator('.clip-header').click({ modifiers: ['Shift'] });
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Group clips']);
	await chooseTrackMenuAction(page, editor, first.locator('xpath=ancestor::div[@data-track-row][1]'), 'Duplicate track');
	const copies = clipByName(editor, toneA.name);
	await expect(copies).toHaveCount(2);
	await copies.nth(1).locator('.clip-header').click();
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(1);
});
