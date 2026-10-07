/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('the focused-track mute shortcut toggles the existing video visibility control', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('video-mute.webm'));
	await editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /Add to timeline/u }).click();
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	await clip.locator('.clip-header').click();
	const row = clip.locator('xpath=ancestor::div[@data-track-row]');
	await expect(row.getByRole('button', { name: 'Hide video', exact: true })).toBeVisible();
	await page.keyboard.press('Shift+u');
	await expect(row.getByRole('button', { name: 'Show video', exact: true })).toBeVisible();
	await page.keyboard.press('Shift+u');
	await expect(row.getByRole('button', { name: 'Hide video', exact: true })).toBeVisible();
});
