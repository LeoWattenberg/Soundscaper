/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { addClipGainPoint } from './helpers/complex-editing-workflows.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('a context click on clip gain preserves its authored point and actual audio', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const clip = clipByName(editor, monoTone.name);
	await addClipGainPoint(page, editor, clip, .5);
	const point = clip.locator('.envelope-point').first();
	const initial = await point.boundingBox();
	expect(initial).not.toBeNull();
	await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2);
	await page.mouse.down();
	await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2 + 32, { steps: 4 });
	await page.mouse.up();
	await expect.poll(async () => (await point.boundingBox())?.y).toBeGreaterThan(initial.y + 20);
	const before = await exportSamples(page, editor);
	expect(rms(before)).toBeLessThan(.2);
	const authored = await point.boundingBox();
	expect(authored).not.toBeNull();
	await page.mouse.click(authored.x + authored.width / 2, authored.y + authored.height / 2, { button: 'right' });
	await page.keyboard.press('Escape');
	const after = await exportSamples(page, editor);
	expect(after).toHaveLength(before.length);
	expect(rms(before.map((sample, frame) => sample - after[frame]))).toBeLessThan(.001);
	await expect(clip.locator('.envelope-point')).toHaveCount(1);
	const retained = await point.boundingBox();
	expect(retained).not.toBeNull();
	await page.mouse.click(retained.x + retained.width / 2, retained.y + retained.height / 2);
	await expect(clip.locator('.envelope-point')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(clip.locator('.envelope-point')).toHaveCount(1);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(clip.locator('.envelope-point')).toHaveCount(0);
});

function rms(samples) {
	return Math.sqrt(samples.reduce((sum, sample) => sum + sample ** 2, 0) / samples.length);
}
