/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseNestedCommandAction, clipByName, commitInput,
	disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function component(samples, frequency) {
	let real = 0;
	let imaginary = 0;
	for (let frame = 273_600; frame < 285_600; frame++) {
		const phase = 2 * Math.PI * frequency * frame / 48_000;
		real += samples[frame] * Math.cos(phase);
		imaginary += samples[frame] * Math.sin(phase);
	}
	return Math.hypot(real, imaginary);
}

test('Speed Delay Preview retains its faster echo throughout the ordinary six-second audition', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	await page.addInitScript(() => {
		window.__round6SpeedDelayPreview = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.buffer) window.__round6SpeedDelayPreview.push({
				samples: Array.from(this.buffer.getChannelData(0).slice(0, 288_000)), duration: this.buffer.duration,
			});
			return Reflect.apply(start, this, args);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'twelve-second-speed-echo.wav', frequency: 440,
		duration: 12, channelCount: 1, channelAmplitudes: [.2] });
	await importFiles(editor, [recording]);
	await clipByName(editor, recording.name).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Delay and reverb', 'Delay']);
	const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await chooseDropdown(page, effect.getByRole('group', { name: 'Pitch change effect', exact: true }), 'Pitch/Tempo (change speed)');
	for (const [name, value] of [['Delay time', '.1'], ['Pitch shift per echo', '2'], ['Number of echoes', '1'], ['Gain per echo', '0']]) {
		await commitInput(effect.getByRole('spinbutton', { name, exact: true }), value);
	}
	await effect.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__round6SpeedDelayPreview.at(-1)?.duration), { timeout: 20_000 }).toBeCloseTo(6, 3);
	const preview = await page.evaluate(() => window.__round6SpeedDelayPreview.at(-1).samples);
	await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(effect).toBeHidden({ timeout: 30_000 });
	const output = await exportSamples(page, editor);
	const frequency = 440 * 2 ** (2 / 12);
	const previewRatio = component(preview, frequency) / component(preview, 440);
	const appliedRatio = component(output, frequency) / component(output, 440);
	console.log('Speed Delay final audition echo/dry ratio', { previewRatio, appliedRatio });
	expect(appliedRatio).toBeGreaterThan(.8);
	expect(appliedRatio).toBeLessThan(1.2);
	expect(Math.abs(previewRatio - appliedRatio)).toBeLessThan(.05);
});
