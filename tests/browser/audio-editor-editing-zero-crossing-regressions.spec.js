/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, chooseCommandAction } from './audio-editor-test-helpers.js';

test('zero crossings follow the selected track independently of unselected audio', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const other = createWavFixture({ name: 'unselected-tone.wav', frequency: 197, channelCount: 1 });
	await importFiles(editor, [monoTone, other]);
	const clip = clipByName(editor, monoTone.name);
	const bounds = await clip.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds.x + bounds.width * 0.42, bounds.y + bounds.height * 0.65);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width * 0.73, bounds.y + bounds.height * 0.65, { steps: 12 });
	await page.mouse.up();
	const timecodes = editor.locator('[data-selection-toolbar] .timecode');
	await timecodes.first().locator('.timecode__format-button').click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	await expect(editor.locator('[data-track-lane][data-selected="true"]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Select', 'At zero crossings');
	await expect(editor.locator('[data-editor-task-progress]')).toBeHidden();
	await expect(editor.locator('[data-status]')).toHaveText(/zero crossings/iu);
	const withOtherTrack = await timecodes.allTextContents();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const otherRow = clipByName(editor, other.name).locator('xpath=ancestor::div[@data-track-row][1]');
	await otherRow.getByRole('button', { name: 'Mute', exact: true }).click();
	await expect(editor.locator('[data-track-lane][data-selected="true"]')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Select', 'At zero crossings');
	await expect(editor.locator('[data-editor-task-progress]')).toBeHidden();
	await expect(editor.locator('[data-status]')).toHaveText(/zero crossings/iu);
	expect(await timecodes.allTextContents()).toEqual(withOtherTrack);
});
