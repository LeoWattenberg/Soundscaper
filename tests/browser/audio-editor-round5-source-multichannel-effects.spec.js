/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, closeClipProperties,
	disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function expectSameAudio(actual, original, polarity = 1) {
	expect(actual.length).toBe(original.length);
	const error = actual.slice(4800, 43_200).reduce((peak, value, index) =>
		Math.max(peak, Math.abs(value - polarity * original[index + 4800])), 0);
	expect(error).toBeLessThan(0.0001);
}

for (const channelCount of [2, 6]) {
	test(`Source editor can process an ordinary ${channelCount}-channel recording`, async ({ page }) => {
		test.setTimeout(60_000);
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		const recording = createWavFixture({ name: `source-${channelCount}-channels.wav`, frequency: 750, duration: 1, channelCount });
		await importFiles(editor, [recording]);
		const before = await exportSamples(page, editor);
		expect(before.some(value => Math.abs(value) > 0.1)).toBe(true);
		const properties = await openClipProperties(page, editor, editor.locator('[data-clip-id]').first());
		const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
		await waveform.focus();
		await waveform.press('Control+a');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
		await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.', { timeout: 20_000 });
		await expect(editor.getByRole('alert')).toHaveCount(0);
		await closeClipProperties(properties);
		expectSameAudio(await exportSamples(page, editor), before, -1);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		expectSameAudio(await exportSamples(page, editor), before);
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		expectSameAudio(await exportSamples(page, editor), before, -1);
	});
}

test('Source spectral editing processes an ordinary six-channel recording', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'six-channel-spectral.wav', frequency: 1000, duration: 1, channelCount: 6 });
	await importFiles(editor, [recording]);
	const clip = editor.locator('[data-clip-id]').first();
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
	const output = (await exportSamples(page, editor)).slice(9600, 38_400);
	const rms = Math.sqrt(output.reduce((sum, value) => sum + value * value, 0) / output.length);
	expect(rms).toBeLessThan(0.01);
});
