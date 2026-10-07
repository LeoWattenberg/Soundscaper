/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseNestedCommandAction, clipByName,
	closeClipProperties, disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Auto Duck in a clip source uses its control track at the clip timeline placement', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const files = ['music', 'voice'].map((name, index) => createWavFixture({
		name: `${name}.wav`, frequency: index ? 1000 : 330, duration: 2,
		channelCount: 1, channelAmplitudes: [0.35],
	}));
	await importFiles(editor, files);
	for (const recording of files) {
		const properties = await openClipProperties(page, editor, clipByName(editor, recording.name));
		await properties.getByText('Media settings', { exact: true }).click();
		const start = properties.getByRole('group', { name: 'Start', exact: true });
		await start.locator('.timecode-digit').first().click();
		await page.keyboard.type('000001000');
		await page.keyboard.press('Enter');
		await expect(start.locator('.timecode__display')).toHaveText('00h00m01.000s');
		await closeClipProperties(properties);
	}
	const voice = clipByName(editor, 'voice.wav');
	await voice.locator('xpath=ancestor::div[@data-track-row]').getByRole('button', { name: 'Mute', exact: true }).click();
	const music = clipByName(editor, 'music.wav');
	const properties = await openClipProperties(page, editor, music);
	const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus();
	await waveform.press('Control+a');
	await expect(waveform.locator('.audio-editor-source-selection')).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Auto Duck']);
	const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await chooseDropdown(page, effect.getByRole('group', { name: 'Control track', exact: true }), 'voice');
	await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(effect).toBeHidden({ timeout: 20_000 });
	await closeClipProperties(properties);
	const output = await exportSamples(page, editor);
	// Measure after the effect's default 500 ms fade-down has completed.
	const firstPhrase = output.slice(81_600, 86_400);
	const peak = firstPhrase.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
	expect(peak).toBeGreaterThan(0.04);
	expect(peak).toBeLessThan(0.08);
});
