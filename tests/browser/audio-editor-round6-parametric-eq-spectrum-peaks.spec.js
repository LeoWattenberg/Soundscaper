/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, closeWorkspacePanel, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

for (const variant of ['neighboring bin', 'skipped high-frequency bin']) {
	test(`Parametric EQ input spectrum retains an ordinary tone in a ${variant}`, async ({ page }) => {
		test.setTimeout(60_000);
		await page.addInitScript(() => {
			const read = AnalyserNode.prototype.getFloatFrequencyData;
			AnalyserNode.prototype.getFloatFrequencyData = function (values) {
				Reflect.apply(read, this, [values]);
				if (values.length === 2048) {
					let index = 0;
					for (let bin = 1; bin < values.length; bin++) if (values[bin] > values[index]) index = bin;
					window.__round6EqSpectrum = { rate: this.context.sampleRate, size: this.fftSize, index, level: values[index] };
				}
			};
		});
		const editor = await bootEditor(page, '/embed/en/');
		const outputRate = await page.evaluate(async () => {
			const context = new AudioContext(); const rate = context.sampleRate; await context.close(); return rate;
		});
		await importFiles(editor, [createWavFixture({ name: 'EQ geometry control.wav', duration: 8, frequency: 440 })]);
		const initialPanel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, initialPanel, 'track', 'Parametric EQ');
		const inputCanvas = page.locator('.audio-editor-parametric-eq__spectrum--input');
		await expect.poll(() => inputCanvas.evaluate(canvas => canvas.width)).toBeGreaterThan(100);
		await expect.poll(() => inputCanvas.evaluate(canvas => canvas.width === Math.max(1,
			Math.round(canvas.getBoundingClientRect().width * Math.min(2, window.devicePixelRatio || 1))))).toBe(true);
		const width = await inputCanvas.evaluate(canvas => canvas.width);
		// Select a normal high-frequency tone halfway between visible samples,
		// and a neighboring tone actually sampled by the original graph.
		const visible = Array.from({ length: Math.ceil(width / 2) }, (_, point) =>
			Math.min(2047, Math.round(10 * (23_520 / 10) ** (2 * point / (width - 1)) / 24_000 * 2048)));
		const gap = visible.slice(1).map((end, index) => ({ start: visible[index], end }))
			.filter(({ start, end }) => start > 1200 && end < 1700).sort((a, b) => (b.end - b.start) - (a.end - a.start))[0];
		expect(gap.end - gap.start).toBeGreaterThan(8);
		const fftBin = variant === 'neighboring bin' ? gap.start : Math.floor((gap.start + gap.end) / 2);
		const frequency = fftBin * outputRate / 4096;
		await page.getByRole('dialog', { name: 'Parametric EQ', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
		await closeWorkspacePanel(editor, 'effects');
		await importFiles(editor, [createWavFixture({ name: 'EQ high tone.wav', duration: 12, frequency,
			channelCount: 1, channelAmplitudes: [.5] })]);
		const panel = await openEffectsForTrack(editor, 2);
		await addRackEffect(page, panel, 'track', 'Parametric EQ');
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(() => page.evaluate(() => window.__round6EqSpectrum?.level ?? -120)).toBeGreaterThan(-35);
		const plot = await inputCanvas.evaluate(canvas => {
			const { width, height } = canvas;
			const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
			let top = height; let first = 0; let last = 0;
			for (let x = 0; x < width; x++) {
				for (let y = 0; y < height; y++) if (pixels[(y * width + x) * 4 + 3] > 20) {
					if (y < top) { top = y; first = x; last = x; } else if (y === top) last = x;
					break;
				}
			}
			return { width, height, top: top / height, peakX: (first + last) / 2 };
		});
		const observed = await page.evaluate(() => window.__round6EqSpectrum);
		console.log('ordinary EQ input spectrum high tone', { frequency, fftBin, width, plot, observed });
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		expect(observed.rate).toBe(outputRate); expect(observed.size).toBe(4096);
		expect(Math.abs(observed.index - fftBin)).toBeLessThanOrEqual(1);
		expect(observed.level).toBeGreaterThan(-35);
		expect(plot.top).toBeLessThan(.35);
		const expectedX = Math.log(frequency / 10) / Math.log(23_520 / 10) * (plot.width - 1);
		expect(Math.abs(plot.peakX - expectedX)).toBeLessThan(4);
	});
}
