/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('long streamed audio settles into painted waveform and localized spectrum after repeated view switches', async ({ page }) => {
	test.setTimeout(60_000);
	const errors = collectClientErrors(page);
	const tone = createWavFixture({ name: 'display-switching-tone.wav', frequency: 440, duration: 32.007, channelCount: 1 });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [tone]);
	await editor.getByRole('button', { name: 'Zoom out', exact: true }).click();
	const clip = clipByName(editor, tone.name);
	const track = clip.locator('xpath=ancestor::div[@data-track-row]');
	const canvas = clip.locator('canvas.clip-body__waveform');
	const chooseView = (view) => chooseTrackMenuAction(page, editor, track, ['Track visualization', view]);

	// Interrupt cold PCM tile analysis before checking the final committed view.
	for (let iteration = 0; iteration < 3; iteration += 1) {
		await chooseView('Spectrogram');
		await chooseView('Waveform');
	}
	for (let iteration = 0; iteration < 2; iteration += 1) {
		await chooseView('Spectrogram');
		await expect(canvas).toHaveAttribute('data-spectrogram-renderer', 'pffft-wasm');
		const spectrum = await canvas.evaluate((element) => {
			const { data, width, height } = element.getContext('2d').getImageData(0, 0, element.width, element.height);
			const rowBrightness = new Array(height).fill(0);
			const visibleColumns = [0, 0, 0];
			for (let x = 0; x < width; x += 1) {
				let visible = false;
				for (let y = 0; y < height; y += 1) {
					const offset = (y * width + x) * 4;
					if (!data[offset + 3]) continue;
					const brightness = Math.max(data[offset], data[offset + 1], data[offset + 2]);
					if (brightness > 64) visible = true;
					if (x > width / 10 && x < width * 0.9) rowBrightness[y] += brightness;
				}
				if (visible) visibleColumns[Math.min(2, Math.floor(x * 3 / width))] += 1;
			}
			return {
				width, height, visibleColumns,
				peakRow: rowBrightness.indexOf(Math.max(...rowBrightness)),
				coloredRows: rowBrightness.filter((brightness) => brightness > width * 0.8 * 64).length,
			};
		});
		expect(spectrum.width).toBeGreaterThan(100);
		for (const visible of spectrum.visibleColumns) expect(visible).toBeGreaterThan(spectrum.width / 4);
		const expectedPeak = 1 - Math.log10(1 + 440 / 700) / Math.log10(1 + 20_000 / 700);
		expect(Math.abs(spectrum.peakRow / spectrum.height - expectedPeak)).toBeLessThan(0.08);
		expect(spectrum.coloredRows).toBeGreaterThan(0);
		expect(spectrum.coloredRows).toBeLessThan(spectrum.height / 3);

		await chooseView('Waveform');
		await expect(canvas).toHaveAttribute('data-waveform-owner', 'audacity');
		await expect(canvas).not.toHaveAttribute('data-spectrogram-renderer');
		await expect.poll(() => canvas.evaluate((element) => {
			const { data } = element.getContext('2d').getImageData(0, 0, element.width, element.height);
			let painted = 0;
			for (let offset = 3; offset < data.length; offset += 4) if (data[offset]) painted += 1;
			return painted;
		})).toBeGreaterThan(100);
		await expect(canvas).not.toHaveAttribute('data-waveform-error');
	}
	expect(errors).toEqual([]);
});
