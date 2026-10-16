/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('a canceled video effect range drag cannot restart before its pointer is released', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('cancel-brightness.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	const properties = await openClipProperties(page, editor, clip);
	const rack = properties.locator('[data-video-effect-rack]');
	await rack.getByRole('button', { name: 'Add effect', exact: true }).click();
	const row = rack.locator('[data-video-effect-type="color-adjust"]');
	const brightness = row.getByRole('slider', { name: 'Brightness', exact: true });
	const value = row.locator('[data-video-effect-param="brightness"] input[type="number"]');
	await expect(value).toHaveValue('0');
	await brightness.scrollIntoViewIfNeeded();
	await expect(brightness).toBeInViewport();
	const box = await brightness.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + box.width * 0.55, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 4 });
	await expect.poll(() => value.inputValue()).not.toBe('0');
	await page.keyboard.press('Escape');
	await expect(value).toHaveValue('0');
	await page.mouse.move(box.x + box.width * 0.9, box.y + box.height / 2, { steps: 4 });
	await page.mouse.up();
	await expect(value).toHaveValue('0');
	await brightness.focus();
	await brightness.press('ArrowRight');
	await brightness.press('Enter');
	await expect(value).toHaveValue('0.01');
});
