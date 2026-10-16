/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

for (const entry of ['track', 'selection']) test(`${entry} Duplicate copies a locked recording and preserves its source`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const clips = clipByName(editor, toneA.name);
	const source = clips.first();
	const track = source.locator('xpath=ancestor::div[@data-track-row]');
	await source.locator('.clip-header').click();
	await duplicate();
	await expect(clips).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clips).toHaveCount(1);
	await chooseTrackMenuAction(page, editor, track, 'Lock track');
	await source.locator('.clip-header').click();
	await duplicate();
	await expect(clips).toHaveCount(2);
	const copyTrack = clips.nth(1).locator('xpath=ancestor::div[@data-track-row]');
	await chooseTrackMenuAction(page, editor, copyTrack, 'Unlock track');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clips).toHaveCount(2);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clips).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clips).toHaveCount(2);
	await chooseTrackMenuAction(page, editor, track, 'Unlock track');
	await expect(clips).toHaveCount(2);

	async function duplicate() {
		if (entry === 'track') await chooseTrackMenuAction(page, editor, track, 'Duplicate track');
		else await chooseCommandAction(page, editor, 'Edit', 'Duplicate');
	}
});
