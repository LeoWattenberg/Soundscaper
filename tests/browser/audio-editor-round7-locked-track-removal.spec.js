/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, getMenuItem, importFiles, openNestedCommandMenu } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('global Remove tracks respects the selected locked recording and recovers after unlocking', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Protected recording.wav', duration: .2, frequency: 440 })]);
	const recording = clipByName(editor, 'Protected recording.wav');
	const track = recording.locator('xpath=ancestor::div[@data-track-row][1]');
	await recording.locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
	await expect(recording).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(recording).toBeVisible();
	await chooseTrackMenuAction(page, editor, track, 'Lock track');
	await expect(recording.getByRole('slider', { name: 'Looped clip length', exact: true })).toBeDisabled();
	await recording.locator('.clip-header').click();
	const command = getMenuItem(await openNestedCommandMenu(page, editor, 'Tracks', []), 'Remove tracks');
	if (await command.getAttribute('aria-disabled') === 'false') {
		await command.click();
		await expect(editor.getByRole('alert')).toContainText(/locked/iu);
		await expect(recording).toBeVisible();
		await editor.getByRole('region', { name: 'Unknown error', exact: true })
			.getByRole('button', { name: 'Close', exact: true }).click();
		await openNestedCommandMenu(page, editor, 'Tracks', []);
	}
	await expect(command).toHaveAttribute('aria-disabled', 'true');
	await page.keyboard.press('Escape');
	await chooseTrackMenuAction(page, editor, track, 'Unlock track');
	await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
	await expect(recording).toHaveCount(0);
});
