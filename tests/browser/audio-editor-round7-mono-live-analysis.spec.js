/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, closeWorkspacePanel, importFiles } from './audio-editor-test-helpers.js';

test('live Spectrum survives an ordinarily authored Mono ADM bed', async ({ page }) => {
	await page.addInitScript(() => {
		window.__round7SpectrumReads = 0;
		window.__round7SplitterWidths = [];
		const read = AnalyserNode.prototype.getFloatFrequencyData;
		AnalyserNode.prototype.getFloatFrequencyData = function (values) {
			Reflect.apply(read, this, [values]);
			if (this.fftSize === 4096) window.__round7SpectrumReads++;
		};
		const split = BaseAudioContext.prototype.createChannelSplitter;
		BaseAudioContext.prototype.createChannelSplitter = function (...args) {
			const result = Reflect.apply(split, this, args);
			window.__round7SplitterWidths.push(result.numberOfOutputs);
			return result;
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'mono-programme.wav', frequency: 440,
		duration: 10, channelCount: 1, channelAmplitudes: [.5] })]);
	await chooseCommandAction(page, editor, 'Analyze', 'Analysis');
	const analysis = editor.locator('[data-workspace-panel="analysis"]');
	await analysis.locator('[data-analysis-section="spectrum"] summary').click();
	const signalPixels = () => analysis.locator('[data-live-analysis-spectrum]').evaluate(canvas => {
		const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, Math.floor(canvas.height * .75));
		let pixels = 0;
		for (let offset = 0; offset < data.length; offset += 4) {
			if (data[offset] < 150 && data[offset + 1] > 120 && data[offset + 2] > 100) pixels++;
		}
		return pixels;
	});
	const playAndVerifyPeak = async () => {
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect.poll(async () => Number.parseFloat(await analysis.locator('[data-live-analysis-value="peak"]').textContent()))
			.toBeGreaterThan(-15);
	};
	await playAndVerifyPeak();
	await expect.poll(signalPixels).toBeGreaterThan(4);
	await expect.poll(() => page.evaluate(() => window.__round7SpectrumReads)).toBeGreaterThan(0);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	await metadata.locator('select[name="adm-bed-layout"]').selectOption('mono');
	await expect(metadata.locator('select[name="adm-bed-layout"]')).toHaveValue('mono');
	await closeWorkspacePanel(editor, 'metadata');
	const previousReads = await page.evaluate(() => window.__round7SpectrumReads);
	await playAndVerifyPeak();
	await expect.poll(() => page.evaluate(() => window.__round7SplitterWidths)).toContain(1);
	await expect.poll(() => page.evaluate(() => window.__round7SpectrumReads)).toBeGreaterThan(previousReads);
	await expect.poll(signalPixels).toBeGreaterThan(4);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
