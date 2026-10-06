/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, closeWorkspacePanel, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';

test('video Properties shows source in on the native source clock after a normal trim', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [videoTimingProbeMedia.find(({ id }) => id === 'cfr-25fps-mp4-v1').file]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await clip.press('Enter');
	await seekFramescaperTimecode(page, editor, '00:00:00:12');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Trim left edge to playhead']);
	const properties = await openClipProperties(page, editor, clip);
	await properties.locator('summary').filter({ hasText: 'Media settings' }).click();
	const sourceIn = properties.getByRole('group', { name: 'Source in', exact: true });
	await expect.poll(async () => (await sourceIn.locator('.timecode-digit').allTextContents()).slice(-3).join('')).toBe('400');
	await sourceIn.locator('.timecode-digit').nth(6).click();
	await page.keyboard.type('240');
	await page.keyboard.press('Enter');
	await closeWorkspacePanel(editor, 'clip-properties');
	await openClipProperties(page, editor, clip);
	await properties.locator('summary').filter({ hasText: 'Media settings' }).click();
	await expect.poll(async () => (await sourceIn.locator('.timecode-digit').allTextContents()).slice(-3).join('')).toBe('240');
});
