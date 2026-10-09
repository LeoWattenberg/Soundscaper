/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, commitInput,
	disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function risingCrossingFrequency(samples, sampleRate = 48_000) {
	const crossings = [];
	for (let frame = 96_001; frame < 120_000; frame++) {
		if (samples[frame - 1] <= 0 && samples[frame] > 0) crossings.push(frame);
	}
	return (crossings.length - 1) * sampleRate / (crossings.at(-1) - crossings[0]);
}

test('Sliding Stretch preview retains the selected recording\'s twelve-second pitch ramp', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	await page.addInitScript(() => {
		window.__round6SlidingPreview = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.buffer) window.__round6SlidingPreview.push({
				samples: Array.from(this.buffer.getChannelData(0).slice(0, 120_000)),
				duration: this.buffer.duration,
			});
			return Reflect.apply(start, this, args);
		};
	});
	const recording = createWavFixture({ name: 'twelve-second-pitch-ramp.wav', frequency: 440,
		duration: 12, channelCount: 1, channelAmplitudes: [.2] });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording]);
	await clipByName(editor, recording.name).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Sliding stretch']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await commitInput(dialog.locator('[data-effect-param="endPitchSemitones"] input[type="number"]'), '12');
	await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__round6SlidingPreview.at(-1)?.duration), { timeout: 20_000 }).toBeCloseTo(6, 3);
	const preview = await page.evaluate(() => window.__round6SlidingPreview.at(-1));
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 30_000 });
	const output = await exportSamples(page, editor);
	const previewFrequency = risingCrossingFrequency(preview.samples);
	const appliedFrequency = risingCrossingFrequency(output);
	expect(appliedFrequency).toBeGreaterThan(480);
	expect(appliedFrequency).toBeLessThan(530);
	expect(Math.abs(previewFrequency - appliedFrequency)).toBeLessThan(5);
});
