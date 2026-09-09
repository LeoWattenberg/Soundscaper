/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles, registerAudioEditorHooks } from './audio-editor-test-helpers.js';

// Exercise Chromium's actual rasterizer: a recording context cannot detect
// the transparency seams caused by adjacent subpixel fillRect calls.
test('summary and RMS columns stay opaque at fractional clip widths and display scales', async ({ page }) => {
	const source = await readFile(new URL('../../src/common/editor/audacity-waveform-renderer.js', import.meta.url), 'utf8');
	await page.addScriptTag({ content: source.replaceAll('export ', '') });
	const results = await page.evaluate(() => {
		const results = [];
		for (const width of [163, 163.5, 163.984, 480.25]) {
			for (const ratio of [1, 1.25, 1.5, 2]) {
				const canvas = document.createElement('canvas');
				canvas.width = Math.round(width * ratio);
				canvas.height = 100;
				const context = canvas.getContext('2d');
				const pixelRatioX = canvas.width / width;
				context.scale(pixelRatioX, 1);
				// Distinct opaque peak/RMS colors expose compositing errors in either pass.
				globalThis.drawAudacityWaveformChannel(context, {
					mode: 'summary', pixelWidth: Math.ceil(width),
					channels: [{ minimum: [-1], maximum: [1], rms: [0.5] }],
				}, { width, centerY: 50, maxAmplitude: 40, pixelRatioX,
					sampleColor: '#102030', rmsColor: '#607080', showRms: true });
				for (const [y, expected] of [[20, [16, 32, 48, 255]], [50, [96, 112, 128, 255]]]) {
					const row = context.getImageData(0, y, canvas.width, 1).data;
					let mismatches = 0;
					for (let x = 0; x < canvas.width; x++) {
						if (expected.some((value, index) => row[x * 4 + index] !== value)) mismatches++;
					}
					results.push({ width, ratio, y, mismatches });
				}
			}
		}
		return results;
	});
	for (const result of results) expect(result.mismatches, JSON.stringify(result)).toBe(0);
});

for (const product of ['soundscaper', 'framescaper']) test.describe(`${product} waveform opacity`, () => {
	registerAudioEditorHooks();
	test('keeps waveform interiors opaque while scrolling fractional-width clips', async ({ page }, testInfo) => {
		const editor = await bootEditor(page, `${product === 'soundscaper' ? '' : '/framescaper'}/embed/en/`);
		const tone = createWavFixture({ name: 'fractional-width.wav', frequency: 220, duration: 8.004, channelCount: 1 });
		await importFiles(editor, [tone]);
		const waveform = clipByName(editor, tone.name).locator('canvas.clip-body__waveform');
		await expect(waveform).toHaveAttribute('data-waveform-renderer', 'audacity');
		await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
		const timeline = editor.locator('[data-timeline]');
		for (const left of [0, 127, 349, 0]) {
			await timeline.evaluate((element, left) => { element.scrollLeft = left; }, left);
			await expect.poll(() => waveform.evaluate((canvas) => {
				const y = Math.floor(canvas.height / 2);
				const pixels = canvas.getContext('2d').getImageData(0, y, canvas.width, 1).data;
				let translucent = 0;
				for (let x = 2; x < canvas.width - 2; x++) if (pixels[x * 4 + 3] !== 255) translucent++;
				return translucent;
			})).toBe(0);
		}
		await page.screenshot({ path: testInfo.outputPath('waveform-without-gradient.png') });
	});
});
