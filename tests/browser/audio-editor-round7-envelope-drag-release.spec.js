/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { addClipGainPoint } from './helpers/complex-editing-workflows.js';

test('clip gain preserves a primary drag through an auxiliary button release', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'Gain release recording.wav', duration: .8 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await addClipGainPoint(page, editor, clip, .5);
	const point = clip.locator('.envelope-point').first();
	const drag = async auxiliary => {
		const box = await point.boundingBox();
		expect(box).not.toBeNull();
		const x = box.x + box.width / 2, y = box.y + box.height / 2;
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x, y + 12, { steps: 3 });
		if (auxiliary) {
			await page.mouse.down({ button: 'middle' });
			await page.mouse.up({ button: 'middle' });
		}
		await page.mouse.move(x, y + 30, { steps: 4 });
		await page.mouse.up();
	};
	const initial = (await point.boundingBox()).y;
	await drag(false);
	await expect.poll(async () => (await point.boundingBox()).y).toBeGreaterThan(initial + 20);
	const completed = (await point.boundingBox()).y;
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(async () => (await point.boundingBox()).y).toBe(initial);
	await drag(true);
	await expect.poll(async () => (await point.boundingBox()).y).toBeCloseTo(completed, 1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(async () => (await point.boundingBox()).y).toBe(initial);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(async () => (await point.boundingBox()).y).toBeCloseTo(completed, 1);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
