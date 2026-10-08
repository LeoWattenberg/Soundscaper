/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, commitInput, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { runSpectralRange } from './helpers/guide-spectral-range.js';

test('Reviewed Utility Gain changes only the authored spectral band', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const file = createWavFixture({ name: 'two-tones.wav', sampleRate: 48_000, duration: 1,
		frequency: 1000, channelCount: 1, channelAmplitudes: [0.2] });
	for (let frame = 0; frame < 48_000; frame++) {
		const sample = 0.2 * (Math.sin(2 * Math.PI * 1000 * frame / 48_000) + Math.sin(2 * Math.PI * 6000 * frame / 48_000));
		file.buffer.writeInt16LE(Math.round(sample * 32767), 44 + frame * 2);
	}
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [file]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const original = await exportSamples(page, editor);
	const unchangedAmplitude = amplitude(original, 6000);
	expect(unchangedAmplitude).toBeGreaterThan(0.12);
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await runSpectralRange(page, editor, { minimum: 900, maximum: 1100, operation: 'select' });
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Utility Gain (Reviewed)']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await commitInput(dialog.locator('[data-effect-param="gain"] input'), '0');
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	await expect(editor.getByRole('alert')).toHaveCount(0);
	const samples = await exportSamples(page, editor);
	expect(Math.abs(amplitude(samples, 6000) - unchangedAmplitude)).toBeLessThan(0.001);
	expect(amplitude(samples, 1000)).toBeLessThan(0.01);
});

function amplitude(samples, frequency) {
	let real = 0;
	let imaginary = 0;
	const start = 9600;
	const end = 38_400;
	for (let frame = start; frame < end; frame++) {
		const phase = 2 * Math.PI * frequency * frame / 48_000;
		real += samples[frame] * Math.cos(phase);
		imaginary += samples[frame] * Math.sin(phase);
	}
	return 2 * Math.hypot(real, imaginary) / (end - start);
}
