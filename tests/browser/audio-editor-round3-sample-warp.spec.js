/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, disableNativeSavePicker,
	importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('sample pencil edits the source sample addressed by an authored warp marker', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'pencil-warp.wav', frequency: 1000,
		duration: 0.002, channelCount: 1 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	const original = await exportSamples(page, editor);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	let warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await warp.getByLabel('Outer position', { exact: true }).fill('32');
	await warp.getByLabel('Source sample', { exact: true }).fill('64');
	await warp.getByRole('button', { name: 'Add marker', exact: true }).click();
	await expect(warp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('64/1');
	await warp.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom to selection']);
	await expect(editor.getByRole('toolbar', { name: 'Sample tools', exact: true })).toBeVisible();
	const box = await clip.locator('.clip-display').boundingBox();
	const canvas = await clip.locator('canvas.clip-body__waveform').boundingBox();
	expect(box).not.toBeNull();
	expect(canvas).not.toBeNull();
	await page.mouse.click(box.x + 32.1 / 96 * box.width, canvas.y + canvas.height * 0.25);
	await expect(editor.locator('[data-status]')).toHaveText('Edited samples.', { timeout: 20_000 });
	// Remove the authored map through its normal menu to inspect the edited raw
	// source, independently of time-stretch reconstruction in the warped export.
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await warp.getByRole('button', { name: 'Clear warp map', exact: true }).click();
	await warp.getByRole('button', { name: 'Close', exact: true }).click();
	const samples = await exportSamples(page, editor);
	expect(samples).toHaveLength(original.length);
	expect(Math.abs(samples[64] - original[64])).toBeGreaterThan(0.1);
	expect(samples[32]).toBeCloseTo(original[32], 4);
});
