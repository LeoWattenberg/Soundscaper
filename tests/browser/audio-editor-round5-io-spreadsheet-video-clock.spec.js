/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, closeWorkspacePanel, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { videoTimingProbeMedia } from './fixtures/video-timing-probe-media.js';

test('the spreadsheet source offset follows the actual trimmed video frame time', async ({ page }) => {
	test.setTimeout(60_000);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = videoTimingProbeMedia.find(({ id }) => id === 'vfr-irregular-webm-v1');
	await importFiles(editor, [recording.file]);
	await closeWorkspacePanel(editor, 'video-preview');
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await clip.press('Enter');
	const properties = await openClipProperties(page, editor, clip);
	await properties.locator('summary').filter({ hasText: 'Media settings' }).click();
	const duration = properties.getByRole('group', { name: 'Duration', exact: true });
	await duration.locator('.timecode-digit').nth(6).click();
	await page.keyboard.type('300');
	await page.keyboard.press('Enter');
	await expect.poll(async () => (await duration.locator('.timecode-digit').allTextContents()).slice(-3).join('')).toBe('300');
	const sourceIn = properties.getByRole('group', { name: 'Source in', exact: true });
	await sourceIn.locator('.timecode-digit').nth(6).click();
	await page.keyboard.type('200');
	await page.keyboard.press('Enter');
	await expect.poll(async () => (await sourceIn.locator('.timecode-digit').allTextContents()).slice(-3).join('')).toBe('200');
	await closeWorkspacePanel(editor, 'clip-properties');
	await chooseNestedCommandAction(page, editor, 'Window', ['Clip spreadsheet']);
	const grid = editor.getByRole('grid', { name: 'Clip spreadsheet', exact: true });
	const offset = grid.locator('[role="gridcell"][data-row="0"][data-column="offset"]');
	await expect(offset).toHaveText('0.2');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await expect(offset).toHaveText('0');
});
