/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { createMonoCameraFixture } from './fixtures/mono-camera-media.js';
import { TRACK_MENU_TRIGGER, chooseTrackMenuAction } from './helpers/track-menu.js';

for (const primary of ['recording', 'camera audio']) test(`Make stereo excludes paired camera lanes for ${primary}`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone, createMonoCameraFixture('stereo-candidate-camera.webm')]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Video preview']);
	const clip = primary === 'recording' ? clipByName(editor, monoTone.name)
		: editor.getByRole('group', { name: /^stereo-candidate-camera Audio clip,/u });
	const track = clip.locator('xpath=ancestor::*[@data-track-row][1]');
	await track.getByRole('button', { name: TRACK_MENU_TRIGGER }).first().click();
	const channels = page.locator('.audio-editor-track-menu').getByRole('menuitem', { name: /^Track channels(?:\s|$)/u });
	await channels.focus(); await channels.press('ArrowRight');
	await expect(channels.getByRole('menuitem', { name: 'Make stereo track', exact: true })).toBeDisabled();
	await page.keyboard.press('Escape');
	await expect(editor).toHaveAttribute('data-clip-count', '3');
	await expect(editor.getByRole('alert')).toHaveCount(0);
	if (primary === 'recording') {
		await importFiles(editor, [{ ...monoTone, name: 'standalone-mono-partner.wav' }]);
		await chooseTrackMenuAction(page, editor, track, ['Track channels', 'Make stereo track']);
		await expect(editor).toHaveAttribute('data-clip-count', '3');
		await expect(editor.getByRole('group', { name: /^stereo-candidate-camera Audio clip,/u })).toBeVisible();
		await expect(editor.getByRole('alert')).toHaveCount(0);
	}
});
