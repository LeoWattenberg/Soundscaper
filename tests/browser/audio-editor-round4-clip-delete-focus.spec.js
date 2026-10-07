/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clickClipInterior, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('deleting a focused clip keeps keyboard continuation on the surviving recording', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const split = editor.getByRole('button', { name: 'Split tool', exact: true });
	await split.click();
	await clickClipInterior(page, clipByName(editor, toneA.name), 0.5);
	await split.click();
	const clips = clipByName(editor, toneA.name);
	await expect(clips).toHaveCount(2);
	await clips.nth(1).locator('.clip-header').click();
	await expect(clips.nth(1)).toBeFocused();
	await page.keyboard.press('Delete');
	await expect(clips).toHaveCount(1);
	await expect(clips).toBeFocused();
	await page.keyboard.press('Enter');
	await expect(clips.locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await page.keyboard.press('F2');
	await expect(clips.getByRole('textbox', { name: 'Clip name', exact: true })).toBeFocused();
});

test('deleting the only focused clip returns keyboard focus to its empty track', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	await clip.locator('.clip-header').click();
	await expect(clip).toBeFocused();
	const trackIndex = await clip.getAttribute('data-track-index');
	const track = editor.locator(`[data-track-row][data-track-index="${trackIndex}"] .track`);
	await page.keyboard.press('Delete');
	await expect(clip).toHaveCount(0);
	await expect(track).toBeFocused();
});
