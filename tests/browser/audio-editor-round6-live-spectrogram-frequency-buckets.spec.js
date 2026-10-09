/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const [label, fftBin] of [['retained neighboring bucket', 278], ['narrow skipped bucket', 296]]) {
	test(`live Spectrogram displays an ordinary tone in the ${label}`, async ({ page }) => {
		await page.addInitScript(() => {
			const read = AnalyserNode.prototype.getFloatFrequencyData;
			AnalyserNode.prototype.getFloatFrequencyData = function (values) {
				Reflect.apply(read, this, [values]);
				if (values.length >= 1024) {
					let index = 0;
					for (let bin = 1; bin < values.length; bin++) if (values[bin] > values[index]) index = bin;
					window.__round6LiveFrequency = { rate: this.context.sampleRate, size: this.fftSize,
						index, level: values[index] };
				}
			};
		});
		const editor = await bootEditor(page, '/embed/en/');
		const sampleRate = await page.evaluate(async () => {
			const context = new AudioContext();
			const rate = context.sampleRate;
			await context.close();
			return rate;
		});
		const frequency = fftBin * sampleRate / 4096;
		await importFiles(editor, [createWavFixture({ name: 'live-analysis-tone.wav', frequency,
			duration: 8, channelCount: 1, channelAmplitudes: [.5] })]);
		await chooseCommandAction(page, editor, 'Analyze', 'Analysis');
		const panel = editor.locator('[data-workspace-panel="analysis"]');
		for (const id of ['spectrum', 'spectrogram']) {
			await panel.locator(`[data-analysis-section="${id}"] summary`).click();
		}
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(async () => Number.parseFloat(await panel.locator('[data-live-analysis-value="peak"]').textContent()))
			.toBeGreaterThan(-15);
		await expect.poll(() => panel.locator('[data-live-analysis-spectrum]').evaluate(canvas => {
			const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, Math.floor(canvas.height * .75));
			let signalPixels = 0;
			for (let offset = 0; offset < data.length; offset += 4) {
				if (data[offset] < 150 && data[offset + 1] > 120 && data[offset + 2] > 100) signalPixels++;
			}
			return signalPixels;
		})).toBeGreaterThan(4);
		// Read the current column after the ordinary playback onset has settled.
		await page.waitForTimeout(1000);
		const brightest = await panel.locator('[data-live-analysis-spectrogram]').evaluate(canvas => {
			const { data } = canvas.getContext('2d').getImageData(canvas.width - 1, 0, 1, canvas.height);
			let maximum = 0;
			for (let offset = 0; offset < data.length; offset += 4) {
				maximum = Math.max(maximum, data[offset], data[offset + 1], data[offset + 2]);
			}
			return maximum;
		});
		const analysis = await page.evaluate(() => window.__round6LiveFrequency);
		console.log('ordinary live Spectrogram tone brightness', { frequency, brightest, analysis });
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		expect(analysis.rate).toBe(sampleRate);
		expect(analysis.size).toBe(4096);
		expect(analysis.index).toBe(fftBin);
		expect(analysis.level).toBeGreaterThan(-35);
		expect(brightest).toBeGreaterThan(190);
	});
}
