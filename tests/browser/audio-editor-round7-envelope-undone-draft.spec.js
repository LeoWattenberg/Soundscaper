/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { addClipGainPoint } from './helpers/complex-editing-workflows.js';

test('Undo retires a held clip-gain draft when its authored points change', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'Undo gain draft.wav', duration: .8 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await chooseCommandAction(page, editor, 'Window', 'History');
	const history = editor.locator('[data-workspace-panel="history"] [data-history-list] > li');
	const before = await history.count();
	await addClipGainPoint(page, editor, clip, .5);
	await expect(history).toHaveCount(before + 1);
	const point = clip.locator('.envelope-point').first();
	const box = await point.boundingBox();
	expect(box).not.toBeNull();
	const x = box.x + box.width / 2, y = box.y + box.height / 2;
	const drag = async () => {
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x, y + 18, { steps: 4 });
	};
	await drag();
	await page.mouse.up();
	await expect(history).toHaveCount(before + 2);
	await expect.poll(async () => (await point.boundingBox())?.y).toBeGreaterThan(box.y + 10);
	await page.keyboard.press('Control+z');
	await expect.poll(async () => (await point.boundingBox())?.y).toBeCloseTo(box.y, 1);
	await page.keyboard.press('Control+z');
	await expect(clip.locator('.envelope-point')).toHaveCount(0);
	await page.keyboard.press('Control+Shift+z');
	await expect(clip.locator('.envelope-point')).toHaveCount(1);
	await expect.poll(async () => (await point.boundingBox())?.y).toBeCloseTo(box.y, 1);
	await drag();
	await expect.poll(async () => (await point.boundingBox())?.y).toBeGreaterThan(box.y + 10);
	await page.keyboard.press('Control+z');
	await page.mouse.up();
	await expect(clip.locator('.envelope-point')).toHaveCount(0);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await page.keyboard.press('Control+Shift+z');
	await expect(clip.locator('.envelope-point')).toHaveCount(1);
	await expect.poll(async () => (await point.boundingBox())?.y).toBeCloseTo(box.y, 1);
});
