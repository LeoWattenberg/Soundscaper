/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

async function colorControls(page) {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('effect-entry.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	const properties = await openClipProperties(page, editor, clip);
	const rack = properties.locator('[data-video-effect-rack]');
	await rack.getByRole('button', { name: 'Add effect', exact: true }).click();
	return { editor, rack, brightness: rack.locator('[data-video-effect-param="brightness"] input[type="number"]') };
}

test('the video effect exact field retains a typed negative decimal prefix', async ({ page }) => {
	const { brightness } = await colorControls(page);
	await brightness.fill('');
	await brightness.pressSequentially('-0.5');
	await brightness.press('Enter');
	await expect(brightness).toHaveValue('-0.5');
});

test('a video effect slider ArrowRight completes one undoable keyboard gesture', async ({ page }) => {
	const { editor, rack, brightness } = await colorControls(page);
	const slider = rack.getByRole('slider', { name: 'Brightness', exact: true });
	await slider.press('ArrowRight');
	await expect(brightness).toHaveValue('0.01');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(rack.locator('[data-video-effect-type="color-adjust"]')).toHaveCount(1);
	await expect(brightness).toHaveValue('0');
});
