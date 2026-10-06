/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, longTone, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('vertical media-row navigation skips tracks hidden inside collapsed folders', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB, longTone]);
	const first = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row][1]');
	const middle = clipByName(editor, toneB.name).locator('xpath=ancestor::div[@data-track-row][1]');
	const last = clipByName(editor, longTone.name).locator('xpath=ancestor::div[@data-track-row][1]');
	await clipByName(editor, toneB.name).locator('.clip-header').click();
	await chooseTrackMenuAction(page, editor, middle, 'Move selection into new folder');
	await editor.getByRole('treeitem').getByRole('button', { name: 'Collapse folder', exact: true }).click();
	await expect(middle).toHaveCount(0);
	const firstContainer = first.getByRole('group', { name: 'Track 2, audio track', exact: true });
	const lastContainer = last.getByRole('group', { name: 'Track 4, audio track', exact: true });
	await firstContainer.focus();
	await page.keyboard.press('ArrowDown');
	await expect(lastContainer).toBeFocused();
	await page.keyboard.press('ArrowUp');
	await expect(firstContainer).toBeFocused();
});
