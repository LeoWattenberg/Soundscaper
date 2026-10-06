/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, monoTone, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('splitting stereo preserves the source track folder for both mono tracks', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clip = clipByName(editor, toneA.name);
	const row = clip.locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, row, 'Move selection into new folder');
	await chooseTrackMenuAction(page, editor, row, ['Track channels', 'Split stereo to centered mono']);
	await expect(editor.locator('[data-clip-id]')).toHaveCount(2);
	const folder = editor.locator('[data-track-folder-row]');
	await folder.focus();
	await folder.press('ArrowLeft');
	await expect(editor.locator('[data-clip-id]')).toHaveCount(0);
});

test('making a stereo track preserves the replaced mono tracks folder', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'other-mono.wav', frequency: 330, channelCount: 1 });
	await importFiles(editor, [monoTone, recording]);
	const first = clipByName(editor, monoTone.name);
	const second = clipByName(editor, recording.name);
	await first.locator('.clip-header').click();
	await second.locator('.clip-header').click({ modifiers: ['Shift'] });
	const row = first.locator('xpath=ancestor::div[@data-track-row][1]');
	await chooseTrackMenuAction(page, editor, row, 'Move selection into new folder');
	await chooseTrackMenuAction(page, editor, row, ['Track channels', 'Make stereo track']);
	await expect(editor.locator('[data-clip-id]')).toHaveCount(1);
	const folder = editor.locator('[data-track-folder-row]');
	await folder.focus();
	await folder.press('ArrowLeft');
	await expect(editor.locator('[data-clip-id]')).toHaveCount(0);
});
