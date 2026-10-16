/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, closeClipProperties,
	commitInput, disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function rms(samples) {
	const body = samples.slice(9_600, 38_400);
	return Math.sqrt(body.reduce((power, value) => power + value * value, 0) / body.length);
}

test('a native-rate Multiband compressor honors a valid crossover close to Nyquist', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'eight-khz-crossover.wav', sampleRate: 8_000,
		frequency: 3_800, duration: 1, channelCount: 1, channelAmplitudes: [.4] });
	await importFiles(editor, [recording]);
	const openEffect = async () => {
		const properties = await openClipProperties(page, editor, editor.locator('[data-clip-id]').first());
		const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
		await waveform.focus();
		await waveform.press('Control+a');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Multiband compressor']);
		return { properties, dialog: page.getByRole('dialog', { name: 'Apply effect', exact: true }) };
	};
	// First publish an ordinary neutral source effect so both comparisons use the
	// same engine path, independent of the importer's streaming resampling path.
	const neutral = await openEffect();
	for (const name of ['Low ratio', 'Mid ratio', 'High ratio']) {
		await commitInput(neutral.dialog.getByRole('spinbutton', { name, exact: true }), '1');
	}
	await neutral.dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(neutral.dialog).toBeHidden({ timeout: 20_000 });
	await closeClipProperties(neutral.properties);
	const before = await exportSamples(page, editor);
	const { properties, dialog } = await openEffect();
	for (const [name, value] of [['High crossover', '3800'], ['Low ratio', '1'], ['Mid ratio', '1'],
		['High ratio', '1'], ['Low gain', '-12'], ['Mid gain', '-12']]) {
		const input = dialog.getByRole('spinbutton', { name, exact: true });
		await commitInput(input, value);
		await expect(input).toHaveValue(value);
	}
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	await closeClipProperties(properties);
	const after = await exportSamples(page, editor);
	console.log('Native crossover exported RMS', { before: rms(before), after: rms(after), gain: rms(after) / rms(before) });
	// At its authored crossover the bilinear low-pass has equal quadrature low/high bands.
	const expectedGain = Math.sqrt((1 + 10 ** (-12 / 10)) / 2);
	expect(rms(after) / rms(before)).toBeCloseTo(expectedGain, 2);
});
