/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, disableNativeSavePicker,
	importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('drawing in a loop repetition edits the source sample shown under the pencil', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'short-wave-cycle.wav', frequency: 1000,
		duration: 0.002, channelCount: 1 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	const original = await exportSamples(page, editor);
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom to selection']);
	await expect(editor.getByRole('toolbar', { name: 'Sample tools', exact: true })).toBeVisible();
	const box = await clip.locator('.clip-display').boundingBox();
	const canvas = await clip.locator('canvas.clip-body__waveform').boundingBox();
	expect(box).not.toBeNull();
	expect(canvas).not.toBeNull();
	const targetFrame = 96 + 32;
	await page.mouse.click(box.x + (targetFrame + 0.1) / 192 * box.width,
		canvas.y + canvas.height * 0.25);
	await expect(editor.locator('[data-status]')).toHaveText('Edited samples.', { timeout: 20_000 });
	const samples = await exportSamples(page, editor);
	expect(samples).toHaveLength(192);
	// This recording's two original periods match. Drawing in the second
	// repeat changes its source sample, hence the same phase in both repeats.
	expect(Math.abs(samples[32] - original[32])).toBeGreaterThan(0.1);
	expect(Math.abs(samples[128] - original[128])).toBeGreaterThan(0.1);
	expect(samples[64]).toBeCloseTo(original[64], 3);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	const restored = await exportSamples(page, editor);
	expect(restored).toHaveLength(original.length);
	// Separate 24-bit PCM exports apply independent dither.
	for (let frame = 0; frame < original.length; frame += 1) {
		expect(Math.abs(restored[frame] - original[frame])).toBeLessThan(0.000001);
	}
});

test('sample pencil honors the waveform vertical magnification', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'short-vertical-cycle.wav', frequency: 1000,
		duration: 0.002, channelCount: 1 });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom to selection']);
	await expect(editor.getByRole('toolbar', { name: 'Sample tools', exact: true })).toBeVisible();
	const draw = async () => {
		const box = await clip.locator('.clip-display').boundingBox();
		const canvas = await clip.locator('canvas.clip-body__waveform').boundingBox();
		await page.mouse.click(box.x + 32.1 / 96 * box.width, canvas.y + canvas.height * 0.25);
		await expect(editor.locator('[data-status]')).toHaveText('Edited samples.', { timeout: 20_000 });
		return exportSamples(page, editor);
	};
	const normal = await draw();
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	const track = clip.locator('xpath=ancestor::div[@data-track-row][1]');
	await track.locator('[data-track-ruler]').click({ button: 'right', position: { x: 20, y: 70 } });
	const menu = page.locator('.audio-editor-ruler-flyout');
	await menu.getByRole('button', { name: 'Zoom in', exact: true }).click();
	await page.keyboard.press('Escape');
	await expect(track.locator('[data-track-ruler]')).toHaveAttribute('data-ruler-zoom', '1');
	const magnified = await draw();
	// The same screen height represents half the amplitude at 2x vertical zoom.
	expect(Math.abs(normal[32])).toBeGreaterThan(0.1);
	expect(magnified[32]).toBeCloseTo(normal[32] / 2, 3);
});
