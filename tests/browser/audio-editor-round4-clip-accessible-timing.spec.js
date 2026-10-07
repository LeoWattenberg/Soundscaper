/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, clickClipInterior, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('short split clips announce their authored timing rather than their painted width', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const split = editor.getByRole('button', { name: 'Split tool', exact: true });
	await split.click();
	await clickClipInterior(page, clipByName(editor, toneA.name), 0.25);
	await split.click();
	const clips = clipByName(editor, toneA.name);
	await expect(clips).toHaveCount(2);
	await clips.nth(0).locator('.clip-header').click();
	await expect(clips.nth(0)).toBeFocused();
	await expect(clips.nth(0)).toHaveAccessibleName(`${toneA.name} clip, starts at 0 seconds, 0.2 seconds long`);
	await clips.nth(1).locator('.clip-header').click();
	await expect(clips.nth(1)).toHaveAccessibleName(`${toneA.name} clip, starts at 0.2 seconds, 0.6 seconds long`);
});
