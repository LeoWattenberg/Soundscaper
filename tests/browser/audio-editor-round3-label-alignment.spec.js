/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Align start to zero moves the selected label track content', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = await clipByName(editor, toneA.name).locator('.clip-display').boundingBox();
	const ruler = await editor.locator('[data-ruler]').boundingBox();
	await page.mouse.move(clip.x + clip.width / 4, ruler.y + 26);
	await page.mouse.down();
	await page.mouse.move(clip.x + clip.width / 2, ruler.y + 26, { steps: 4 });
	await page.mouse.up();
	await page.keyboard.press('Control+b');
	await editor.getByRole('textbox', { name: /^Edit labels:/u }).press('Enter');
	await editor.locator('[data-label-track] [data-track-lane]').click({ position: { x: 200, y: 50 } });
	await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
	const panel = editor.locator('[data-workspace-panel="labels"]');
	await expect(panel.locator('.timecode__display').first()).toHaveText('00h00m00.200s');
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Align content', 'Align start to zero']);
	await expect(panel.locator('.timecode__display').first()).toHaveText('00h00m00.000s');
	await expect(panel.locator('.timecode__display').nth(1)).toHaveText('00h00m00.200s');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(panel.locator('.timecode__display').first()).toHaveText('00h00m00.200s');
	await expect(panel.locator('.timecode__display').nth(1)).toHaveText('00h00m00.400s');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(panel.locator('.timecode__display').first()).toHaveText('00h00m00.000s');
});
