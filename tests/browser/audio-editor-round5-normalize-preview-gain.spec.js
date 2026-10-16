/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function peak(samples) {
	return samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
}

test('Normalize preview plays the same gain that Apply uses for the full recording', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	await page.addInitScript(() => {
		window.__round5NormalizePreview = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.buffer) {
				const samples = this.buffer.getChannelData(0);
				let peak = 0;
				for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
				window.__round5NormalizePreview.push({ peak, duration: this.buffer.duration });
			}
			return Reflect.apply(start, this, args);
		};
	});
	const recording = createWavFixture({ name: 'quiet-then-louder.wav', frequency: 440,
		duration: 8, channelCount: 1, channelAmplitudes: [0.1] });
	for (let frame = 288_000; frame < 384_000; frame++) {
		recording.buffer.writeInt16LE(Math.round(0.9 * 32_767 * Math.sin(2 * Math.PI * 440 * frame / 48_000)), 44 + frame * 2);
	}
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording]);
	await clipByName(editor, recording.name).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Normalize']);
	const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await effect.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect(effect.getByRole('button', { name: 'Preview', exact: true })).toBeEnabled({ timeout: 20_000 });
	await expect.poll(() => page.evaluate(() => window.__round5NormalizePreview.at(-1)?.duration), { timeout: 20_000 }).toBeCloseTo(6, 3);
	const preview = await page.evaluate(() => window.__round5NormalizePreview.at(-1));
	expect(preview.duration).toBeCloseTo(6, 3);
	await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(effect).toBeHidden({ timeout: 20_000 });
	const output = await exportSamples(page, editor);
	const applied = peak(output.slice(0, 288_000));
	expect(applied).toBeGreaterThan(0.06);
	expect(applied).toBeLessThan(0.08);
	// The mono track is exported through the existing constant-power stereo pan.
	expect(preview.peak).toBeCloseTo(applied * Math.SQRT2, 3);
});
