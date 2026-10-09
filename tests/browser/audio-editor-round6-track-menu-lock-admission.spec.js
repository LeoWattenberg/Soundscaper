/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB, monoTone, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction, TRACK_MENU_TRIGGER } from './helpers/track-menu.js';

test('Track menu source and structure commands follow the ordinary track lock', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	const row = clipByName(editor, toneA.name).locator('xpath=ancestor::*[@data-track-row][1]');
	const open = async () => {
		await row.getByRole('button', { name: TRACK_MENU_TRIGGER }).first().click();
		const menu = page.locator('.audio-editor-track-menu');
		await expect(menu).toBeVisible();
		return menu;
	};
	let menu = await open();
	await expect(menu.getByRole('menuitem', { name: /^Track channels(?:\s|$)/u })).toBeEnabled();
	await expect(menu.getByRole('menuitem', { name: /^Move track(?:\s|$)/u }).first()).toBeEnabled();
	await page.keyboard.press('Escape');
	await chooseTrackMenuAction(page, editor, row, 'Lock track');
	menu = await open();
	await expect(menu.getByRole('menuitem', { name: /^Track channels(?:\s|$)/u })).toBeDisabled();
	await expect(menu.getByRole('menuitem', { name: /^Move track(?:\s|$)/u }).first()).toBeDisabled();
	await expect(menu.getByRole('menuitem', { name: /^Delete track(?:\s|$)/u })).toBeDisabled();
	await expect(menu.getByRole('menuitem', { name: /^Duplicate track(?:\s|$)/u })).toBeEnabled();
	await expect(menu.getByRole('menuitem', { name: /^Unlock track(?:\s|$)/u })).toBeEnabled();
	await page.keyboard.press('Escape');
	await chooseTrackMenuAction(page, editor, row, 'Unlock track');
	menu = await open();
	const channels = menu.getByRole('menuitem', { name: /^Track channels(?:\s|$)/u });
	await expect(channels).toBeEnabled();
	await channels.focus();
	await channels.press('ArrowRight');
	await expect(channels.getByRole('menuitem', { name: 'Split stereo to left/right mono', exact: true })).toBeEnabled();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await chooseTrackMenuAction(page, editor, row, ['Track channels', 'Split stereo to left/right mono']);
	await expect(editor.getByRole('group', { name: /^browser-tone-a.* clip, starts/u })).toHaveCount(2);
});


test('Make stereo menu declines the ordinary locked mono partner', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const other = createWavFixture({ name: 'other-mono.wav', frequency: 660, channelCount: 1 });
	await importFiles(editor, [monoTone, other]);
	const row = clipByName(editor, monoTone.name).locator('xpath=ancestor::*[@data-track-row][1]');
	const partner = clipByName(editor, other.name).locator('xpath=ancestor::*[@data-track-row][1]');
	const open = async () => {
		await row.getByRole('button', { name: TRACK_MENU_TRIGGER }).first().click();
		const channels = page.locator('.audio-editor-track-menu').getByRole('menuitem', { name: /^Track channels(?:\s|$)/u });
		await channels.focus();
		await channels.press('ArrowRight');
		return channels.getByRole('menuitem', { name: 'Make stereo track', exact: true });
	};
	await expect(await open()).toBeEnabled();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await chooseTrackMenuAction(page, editor, partner, 'Lock track');
	await expect(await open()).toBeDisabled();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await chooseTrackMenuAction(page, editor, partner, 'Unlock track');
	await expect(await open()).toBeEnabled();
	await page.keyboard.press('Escape');
	await page.keyboard.press('Escape');
	await chooseTrackMenuAction(page, editor, row, ['Track channels', 'Make stereo track']);
	await expect(editor.getByRole('group', { name: /^browser-mono-tone clip, starts/u })).toHaveCount(1);
});
