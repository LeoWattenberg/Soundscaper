/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';

test('deleting a recording retires its held sample-pencil stroke before pointer release', async ({ page }) => {
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'Sample stroke recording.wav', duration: .002, frequency: 1000, channelCount: 1 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom to selection']);
	await expect(editor.getByRole('toolbar', { name: 'Sample tools', exact: true })).toBeVisible();
	const box = await clip.locator('.clip-display').boundingBox();
	const canvas = await clip.locator('canvas.clip-body__waveform').boundingBox();
	expect(box).not.toBeNull(); expect(canvas).not.toBeNull();
	const x = box.x + 32.1 / 96 * box.width;
	const y = canvas.y + canvas.height * .25;
	await page.mouse.click(x, y);
	await expect(editor.locator('[data-status]')).toHaveText('Edited samples.', { timeout: 20_000 });
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 10, y + 4, { steps: 3 });
	await page.keyboard.press('Delete');
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await page.mouse.up();
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	await expect(editor.getByRole('alert')).toHaveCount(0);
	expect(errors).toEqual([]);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
});
