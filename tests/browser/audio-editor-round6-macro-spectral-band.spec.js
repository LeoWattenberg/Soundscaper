/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { runSpectralRange } from './helpers/guide-spectral-range.js';

test('a macro effect preserves recording frequencies outside its authored spectral band', async ({ page }) => {
	await disableNativeSavePicker(page);
	const file = createWavFixture({ name: 'macro-two-tones.wav', sampleRate: 48_000, duration: 1,
		frequency: 1000, channelCount: 1, channelAmplitudes: [.2] });
	for (let frame = 0; frame < 48_000; frame++) {
		const sample = .2 * (Math.sin(2 * Math.PI * 1000 * frame / 48_000) + Math.sin(2 * Math.PI * 6000 * frame / 48_000));
		file.buffer.writeInt16LE(Math.round(sample * 32767), 44 + frame * 2);
	}
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [file]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const before = await exportSamples(page, editor);
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await runSpectralRange(page, editor, { minimum: 900, maximum: 1100, operation: 'select' });
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const palette = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await palette.getByRole('button', { name: 'New program', exact: true }).click();
	await palette.getByRole('textbox', { name: 'Program', exact: true }).fill(
		"await sound.effect('audacity-amplify', {gainDb:-12, allowClipping:true});",
	);
	await palette.getByRole('button', { name: 'Run program', exact: true }).click();
	await expect(palette.locator('[data-macro-script-log]')).toHaveAttribute('data-outcome', 'completed');
	await palette.getByRole('button', { name: 'Close', exact: true }).click();
	const after = await exportSamples(page, editor);
	expect(amplitude(after, 1000) / amplitude(before, 1000)).toBeLessThan(.3);
	expect(Math.abs(amplitude(after, 6000) - amplitude(before, 6000))).toBeLessThan(.001);
});

function amplitude(samples, frequency) {
	let real = 0;
	let imaginary = 0;
	for (let frame = 9600; frame < 38_400; frame++) {
		const phase = 2 * Math.PI * frequency * frame / 48_000;
		real += samples[frame] * Math.cos(phase);
		imaginary += samples[frame] * Math.sin(phase);
	}
	return 2 * Math.hypot(real, imaginary) / 28_800;
}
