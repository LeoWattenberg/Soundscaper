/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, disableNativeSavePicker,
	importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function frequency(samples, start, end) {
	let crossings = 0;
	for (let frame = start + 1; frame < end; frame++) {
		if (samples[frame - 1] <= 0 && samples[frame] > 0) crossings++;
	}
	return crossings * 48_000 / (end - start);
}

test('warp authoring refuses looping before mutation and recovers after returning to one repeat', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'loop-identity-warp.wav', frequency: 750,
		duration: 0.8, channelCount: 1 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	const original = await exportSamples(page, editor);
	expect(original.length).toBe(76_800);
	expect(frequency(original, 4800, 14_400)).toBeGreaterThan(740);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	const dialog = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await dialog.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await expect(dialog).toContainText('Turn off clip looping before authoring a warp map.');
	await expect(dialog).toContainText('No warp map is authored.');
	await page.keyboard.press('Escape');
	const samples = await exportSamples(page, editor);
	expect(samples.length).toBe(original.length);
	expect(frequency(samples, 4800, 14_400)).toBeGreaterThan(740);
	expect(frequency(samples, 4800, 14_400)).toBeLessThan(760);
	expect(frequency(samples, 43_200, 52_800)).toBeGreaterThan(740);
	expect(frequency(samples, 43_200, 52_800)).toBeLessThan(760);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await clip.locator('.clip-header').click();
	const loop = clip.getByRole('slider', { name: 'Looped clip length', exact: true });
	await expect(loop).toHaveAttribute('aria-valuenow', '0.8');
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(loop).toHaveAttribute('aria-valuenow', '1.6');
	await loop.press('ArrowLeft');
	await expect(loop).toHaveAttribute('aria-valuenow', '0.8');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	await dialog.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await expect(dialog).toContainText('Identity warp map created.');
	await page.keyboard.press('Escape');
	const recovered = await exportSamples(page, editor);
	expect(recovered.length).toBe(38_400);
	expect(frequency(recovered, 4800, 14_400)).toBeGreaterThan(740);
	expect(frequency(recovered, 4800, 14_400)).toBeLessThan(760);
});
