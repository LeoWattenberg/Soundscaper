/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('Silence labeled audio retains each recording channel width', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
	await importFiles(editor, [monoTone, toneA]);
	const row = clipByName(editor, toneA.name).locator('xpath=ancestor::*[@data-track-row][1]');
	const trackId = await row.getAttribute('data-track-id');
	const stereo = editor.locator(`[data-track-row][data-track-id="${trackId}"]`);
	await expectStereoCommands(page, stereo);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await page.keyboard.press('Control+b');
	await editor.getByRole('textbox', { name: /^Edit labels:/u }).press('Enter');
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Labeled audio', 'Silence audio']);
	await expect(editor.getByRole('group', { name: /^Silence audio clip,/u })).toHaveCount(2);
	await expectStereoCommands(page, stereo);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expectStereoCommands(page, stereo);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expectStereoCommands(page, stereo);
});

async function expectStereoCommands(page, row) {
	await row.getByRole('button', { name: 'Track menu', exact: true }).click();
	const channels = page.locator('.audio-editor-track-menu').getByRole('menuitem', { name: /^Track channels(?:\s|$)/u });
	await channels.focus();
	await channels.press('ArrowRight');
	await expect(channels.getByRole('menuitem', { name: 'Split stereo to left/right mono', exact: true })).toBeEnabled();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
}
