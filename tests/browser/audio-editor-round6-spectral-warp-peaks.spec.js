/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { bootEditor, chooseCommandAction, clipByName,
	disableNativeSavePicker, chooseNestedCommandAction, importFiles } from './audio-editor-test-helpers.js';

test('spectral center snapping follows audible authored warp playback', async ({ page }) => {
	test.setTimeout(120_000);
	await disableNativeSavePicker(page);
	await page.setViewportSize({ width: 1920, height: 1000 });
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'spectral-warp.wav', frequency: 512,
		sampleRate: 8192, duration: 4, channelCount: 1, channelAmplitudes: [.5] });
	await importFiles(editor, [recording]);
	const clip = clipByName(editor, recording.name);
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	const warp = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	await warp.getByRole('button', { name: 'Create identity warp map', exact: true }).click();
	await warp.getByLabel('Outer position', { exact: true }).fill('96000');
	await warp.getByLabel('Source sample', { exact: true }).fill('24576');
	await warp.getByRole('button', { name: 'Add marker', exact: true }).click();
	await expect(warp.getByLabel('Marker 1 source sample', { exact: true })).toHaveValue('24576/1');
	await warp.getByRole('button', { name: 'Close', exact: true }).click();
	const delivered = await exportSamples(page, editor);
	expect(toneAmplitude(delivered, 768)).toBeGreaterThan(.1);
	expect(toneAmplitude(delivered, 512)).toBeLessThan(.01);
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Track display$/u }).click();
	const settings = preferences.locator('[data-spectrogram-settings]');
	await settings.getByLabel('Scale', { exact: true }).selectOption('linear');
	await settings.getByLabel('Maximum frequency (Hz)', { exact: true }).fill('2000');
	await settings.getByLabel('Window size', { exact: true }).selectOption('2048');
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const track = clip.locator('xpath=ancestor::div[@data-track-row]');
	await track.getByRole('button', { name: 'Track menu', exact: true }).click();
	const display = page.locator('.audio-editor-track-menu').getByRole('menuitem', { name: /^Track visualization(?:\s|$)/u });
	await display.focus(); await page.keyboard.press('ArrowRight');
	await display.getByRole('menu').getByRole('menuitem', { name: 'Spectrogram', exact: true }).click();
	await clip.focus(); await clip.press('Control+a');
	await editor.getByRole('button', { name: 'Spectrogram options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Select spectral frequency range', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
	await dialog.getByRole('textbox', { name: /^Minimum frequency \(Hz\)/u }).fill('100');
	await dialog.getByRole('textbox', { name: /^Maximum frequency \(Hz\)/u }).fill('300');
	await dialog.getByRole('button', { name: 'Select range', exact: true }).click();
	await expect(clip.locator('canvas.clip-body__waveform')).toHaveAttribute('data-spectrogram-renderer', 'pffft-wasm', { timeout: 45_000 });
	const center = track.getByRole('slider', { name: 'Spectral selection center-frequency handle', exact: true });
	const box = await center.boundingBox();
	const lane = await track.locator('[data-track-lane]').boundingBox();
	const bodyTop = Number(await track.locator('[data-track-lane]').getAttribute('data-channel-body-top'));
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, lane.y + bodyTop + (lane.height - bodyTop) * .6, { steps: 4 });
	await page.mouse.up();
	await expect.poll(async () => Number(await center.getAttribute('aria-valuenow'))).toBeCloseTo(768, 0);
});

function toneAmplitude(samples, frequency) {
	const middle = samples.slice(24_000, 48_000);
	let sine = 0;
	let cosine = 0;
	for (const [frame, sample] of middle.entries()) {
		const angle = 2 * Math.PI * frequency * frame / 48_000;
		sine += sample * Math.sin(angle);
		cosine += sample * Math.cos(angle);
	}
	return 2 * Math.hypot(sine, cosine) / middle.length;
}
