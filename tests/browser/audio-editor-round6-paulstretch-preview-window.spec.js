/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, commitInput,
	disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Paulstretch Preview accepts a resolution supported by the actual selected recording', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	await page.addInitScript(() => {
		window.__round6PaulstretchPreview = null;
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.context instanceof AudioContext && this.buffer) window.__round6PaulstretchPreview = this.buffer.duration;
			return Reflect.apply(start, this, args);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'twelve-second-window-tone.wav', frequency: 440,
		duration: 12, channelCount: 1, channelAmplitudes: [.2] });
	await importFiles(editor, [recording]);
	await clipByName(editor, recording.name).locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Paulstretch']);
	const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await commitInput(effect.getByRole('spinbutton', { name: 'Stretch factor', exact: true }), '1');
	const resolution = effect.locator('[data-effect-param="timeResolution"]');
	await resolution.locator('.timecode-digit').first().click();
	await page.keyboard.type('000008000');
	await page.keyboard.press('Enter');
	await expect(resolution.locator('.timecode__display')).toHaveText('00h00m08.000s');
	await effect.getByRole('button', { name: 'Preview', exact: true }).click();
	await expect.poll(async () => await page.evaluate(() => window.__round6PaulstretchPreview !== null)
		|| await page.getByRole('alert').count() > 0, { timeout: 30_000 }).toBe(true);
	const preview = await page.evaluate(() => window.__round6PaulstretchPreview);
	const error = await page.getByRole('alert').allTextContents();
	await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(effect).toBeHidden({ timeout: 30_000 });
	const output = await exportSamples(page, editor);
	expect(output.length).toBe(576_000);
	expect(output.every(Number.isFinite)).toBe(true);
	expect(Math.max(...output.slice(48_000, 58_000).map(Math.abs))).toBeGreaterThan(.05);
	console.log('valid Paulstretch selection preview', { preview, error });
	expect(preview).toBeCloseTo(6, 3);
});
