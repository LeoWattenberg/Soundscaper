/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('Mute all tracks and Unmute all tracks update picture visibility', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('mute-all-picture.webm'));
	await editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /Add to timeline/u }).click();
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	const row = clip.locator('xpath=ancestor::div[@data-track-row]');
	await expect(row.getByRole('button', { name: 'Hide video', exact: true })).toBeVisible();
	await chooseCommandAction(page, editor, 'Tracks', 'Mute all tracks');
	await expect(row.getByRole('button', { name: 'Show video', exact: true })).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(row.getByRole('button', { name: 'Hide video', exact: true })).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(row.getByRole('button', { name: 'Show video', exact: true })).toBeVisible();
	await chooseCommandAction(page, editor, 'Tracks', 'Unmute all tracks');
	await expect(row.getByRole('button', { name: 'Hide video', exact: true })).toBeVisible();
});
