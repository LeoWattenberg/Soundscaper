/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, closeClipProperties, disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('spectral deletion processes a source selection in its native frequency clock', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const file = createWavFixture({ name: 'native-tone.wav', sampleRate: 24_000, duration: 1,
		frequency: 1000, channelCount: 1, channelAmplitudes: [0.35] });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [file]);
	const clip = clipByName(editor, file.name);
	await clip.locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	const properties = await openClipProperties(page, editor, clip);
	const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus();
	await waveform.press('Control+a');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Spectral editing', 'Spectral box select']);
	const spectral = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
	await spectral.getByRole('textbox', { name: /^Minimum frequency \(Hz\)/u }).fill('900');
	await spectral.getByRole('textbox', { name: /^Maximum frequency \(Hz\)/u }).fill('1100');
	await spectral.getByRole('button', { name: 'Spectral Delete', exact: true }).click();
	await expect(spectral).toBeHidden({ timeout: 20_000 });
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await closeClipProperties(properties);
	const samples = await exportSamples(page, editor);
	const window = samples.slice(9_600, 38_400);
	const rms = Math.sqrt(window.reduce((sum, value) => sum + value * value, 0) / window.length);
	expect(rms).toBeLessThan(0.01);
});
