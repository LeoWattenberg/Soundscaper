/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, closeWorkspacePanel, commitInput, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';

for (const variant of ['neighboring bin', 'skipped high-frequency bin', 'quieter neighboring bin']) {
	test(`Parametric EQ input spectrum retains an ordinary tone in a ${variant}`, async ({ page }) => {
		test.setTimeout(60_000);
		await page.addInitScript(() => {
			const readings = [];
			const read = AnalyserNode.prototype.getFloatFrequencyData;
			AnalyserNode.prototype.getFloatFrequencyData = function (values) {
				Reflect.apply(read, this, [values]);
				if (values.length === 2048) {
					let index = 0;
					for (let bin = 1; bin < values.length; bin++) if (values[bin] > values[index]) index = bin;
					readings.push({ rate: this.context.sampleRate, size: this.fftSize, index, level: values[index] });
				}
			};
			const fill = CanvasRenderingContext2D.prototype.fill;
			CanvasRenderingContext2D.prototype.fill = function (...args) {
				const result = Reflect.apply(fill, this, args);
				// The hook reads input then output synchronously before painting either.
				// Associate this canvas with its own input read, not the later output read.
				if (this.canvas.matches('.audio-editor-parametric-eq__spectrum--input')) {
					window.__round6EqSpectrum = { ...readings[0], readCount: readings.length, outputLevel: readings[1]?.level };
				}
				if (this.canvas.matches('.audio-editor-parametric-eq__spectrum--output')) readings.length = 0;
				return result;
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
		const fftBin = variant === 'skipped high-frequency bin' ? Math.floor((gap.start + gap.end) / 2) : gap.start;
		const frequency = fftBin * outputRate / 4096;
		await page.getByRole('dialog', { name: 'Parametric EQ', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
		await closeWorkspacePanel(editor, 'effects');
		await importFiles(editor, [createWavFixture({ name: 'EQ high tone.wav', duration: 12, frequency,
			channelCount: 1, channelAmplitudes: [variant === 'quieter neighboring bin' ? .2 : .5] })]);
		const panel = await openEffectsForTrack(editor, 2);
		await addRackEffect(page, panel, 'track', 'Parametric EQ');
		if (variant === 'quieter neighboring bin') {
			await commitInput(page.getByRole('dialog', { name: 'Parametric EQ', exact: true })
				.locator('.audio-editor-parametric-eq__output input[type="number"]'), '6');
		}
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(() => page.evaluate(() => window.__round6EqSpectrum?.level ?? -120)).toBeGreaterThan(-35);
		// The probe reads input and output analysers independently. Capture the
		// input peak's height and position together after its painted frame is ready.
		let spectrum;
		await expect.poll(async () => {
			spectrum = await inputCanvas.evaluate(canvas => {
				const { width, height } = canvas;
				const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
				let top = height; let first = 0; let last = 0;
				for (let x = 0; x < width; x++) {
					for (let y = 0; y < height; y++) if (pixels[(y * width + x) * 4 + 3] > 20) {
						if (y < top) { top = y; first = x; last = x; } else if (y === top) last = x;
						break;
					}
				}
				return { plot: { width, height, top: top / height, peakX: (first + last) / 2 },
					observed: window.__round6EqSpectrum };
			});
			return spectrum.plot.top;
		}).toBeLessThan(.35);
		const { plot, observed } = spectrum;
		console.log('ordinary EQ input spectrum high tone', { frequency, fftBin, width, plot, observed });
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		expect(observed.rate).toBe(outputRate); expect(observed.size).toBe(4096);
		expect(observed.readCount, 'the mono fixture must read one input and one output analyser per paint').toBe(2);
		expect(Math.abs(observed.index - fftBin)).toBeLessThanOrEqual(1);
		expect(observed.level).toBeGreaterThan(-35);
		expect(plot.top).toBeLessThan(.35);
		expect(Math.abs(plot.top * plot.height + observed.level / 120 * plot.height)).toBeLessThan(2);
		if (variant === 'quieter neighboring bin') expect(observed.outputLevel - observed.level).toBeCloseTo(6, 1);
		const expectedX = Math.log(frequency / 10) / Math.log(23_520 / 10) * (plot.width - 1);
		expect(Math.abs(plot.peakX - expectedX)).toBeLessThan(4);
	});
}
