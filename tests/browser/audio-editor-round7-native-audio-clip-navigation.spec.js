/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clickClipInterior, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('audio clip navigation survives an ordinary generated Title in its project', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [toneA]);
	const split = editor.getByRole('button', { name: 'Split tool', exact: true });
	await split.click();
	await clickClipInterior(page, clipByName(editor, toneA.name), 0.5);
	await split.click();
	const clips = editor.locator('[data-track-row]:not([data-video-track]) [data-clip-id]');
	await expect(clips).toHaveCount(2);
	const navigate = () => chooseNestedCommandAction(page, editor, 'Select', ['Audio clips', 'Next clip']);
	await clips.nth(0).locator('.clip-header').click();
	await navigate();
	await expect(clips.nth(1).locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Title/Text']);
	await expect(editor.getByRole('group', { name: 'Video clip: Title', exact: true })).toBeVisible();
	await clips.nth(0).locator('.clip-header').click();
	await expect(clips.nth(0).locator('.clip-display')).toHaveAttribute('data-selected', 'true');
	await navigate();
	await expect(clips.nth(1).locator('.clip-display')).toHaveAttribute('data-selected', 'true');
});
