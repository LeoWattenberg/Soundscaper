/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { addClipGainPoint } from './helpers/complex-editing-workflows.js';

test('deleting a recording retires its active clip-gain draft before pointer release', async ({ page }) => {
	const errors = [];
	page.on('pageerror', error => errors.push(error.message));
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'Gain draft recording.wav', duration: .8 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await addClipGainPoint(page, editor, clip, .5);
	const point = clip.locator('.envelope-point').first();
	let bounds = await point.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + 18, { steps: 4 });
	await page.mouse.up();
	await expect.poll(async () => (await point.boundingBox())?.y).toBeGreaterThan(bounds.y + 10);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clip.locator('.envelope-point')).toHaveCount(1);
	bounds = await point.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 + 18, { steps: 4 });
	await page.keyboard.press('Delete');
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await page.mouse.up();
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	await expect(editor.getByRole('alert')).toHaveCount(0);
	expect(errors).toEqual([]);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(clip.locator('.envelope-point')).toHaveCount(1);
});
