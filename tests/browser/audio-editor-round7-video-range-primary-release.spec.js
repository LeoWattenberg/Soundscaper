/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

test('video Brightness publishes its primary edit while middle remains held', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('primary-range.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	const properties = await openClipProperties(page, editor, clip);
	const rack = properties.locator('[data-video-effect-rack]');
	await rack.getByRole('button', { name: 'Add effect', exact: true }).click();
	const effect = rack.locator('[data-video-effect-id]');
	const range = rack.getByRole('slider', { name: 'Brightness', exact: true });
	await range.scrollIntoViewIfNeeded();
	await expect(range).toHaveValue('0');
	const box = await range.boundingBox();
	expect(box).not.toBeNull();
	const x = box.x + box.width / 2, y = box.y + box.height / 2;
	const drag = async () => {
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * .75, y, { steps: 5 });
	};
	await drag();
	await page.mouse.up();
	const completed = await range.inputValue();
	expect(Number(completed)).toBeGreaterThan(0);
	await page.keyboard.press('ControlOrMeta+z');
	await expect(effect).toHaveCount(1);
	await expect(range).toHaveValue('0');
	await drag();
	await expect(range).toHaveValue(completed);
	await page.evaluate(() => document.addEventListener('pointermove', function released(event) {
		if (event.pointerType !== 'mouse' || event.button !== 0 || event.buttons !== 4) return;
		document.documentElement.dataset.brightnessReleasedButton = String(event.button);
		document.documentElement.dataset.brightnessHeldButtons = String(event.buttons);
		document.removeEventListener('pointermove', released, true);
	}, true));
	await page.mouse.down({ button: 'middle' });
	await page.mouse.up();
	await expect(page.locator('html')).toHaveAttribute('data-brightness-released-button', '0');
	await expect(page.locator('html')).toHaveAttribute('data-brightness-held-buttons', '4');
	await page.mouse.move(box.x + box.width * .9, y, { steps: 4 });
	await expect(range).toHaveValue(completed);
	await page.keyboard.press('ControlOrMeta+z');
	await expect(effect).toHaveCount(1);
	await expect(range).toHaveValue('0');
	await page.mouse.up({ button: 'middle' });
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(range).toHaveValue(completed);
	expect(errors).toEqual([]);
});


test('video Brightness retains native outside release and keyboard history', async ({ page }) => {
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createDeterministicSilentVideoFixture('outside-range.webm')]);
	const clip = editor.getByRole('group', { name: /^Video clip:/u }).first();
	const properties = await openClipProperties(page, editor, clip);
	const rack = properties.locator('[data-video-effect-rack]');
	await rack.getByRole('button', { name: 'Add effect', exact: true }).click();
	const effect = rack.locator('[data-video-effect-id]');
	const range = rack.getByRole('slider', { name: 'Brightness', exact: true });
	await range.scrollIntoViewIfNeeded();
	await expect(range).toHaveValue('0');
	const box = await range.boundingBox();
	expect(box).not.toBeNull();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width + 30, box.y + box.height / 2, { steps: 5 });
	await page.mouse.up();
	await expect(range).toHaveValue('1');
	await page.keyboard.press('ControlOrMeta+z');
	await expect(effect).toHaveCount(1);
	await expect(range).toHaveValue('0');
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(range).toHaveValue('1');
	await range.press('ArrowLeft');
	await range.press('Enter');
	await expect(range).toHaveValue('0.99');
	await page.keyboard.press('ControlOrMeta+z');
	await expect(range).toHaveValue('1');
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(range).toHaveValue('0.99');
	expect(errors).toEqual([]);
});
