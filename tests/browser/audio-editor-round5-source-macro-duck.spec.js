/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, closeClipProperties, disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const sourceMode of [true, false]) test(`an Auto Duck macro retains its voice control in the ${sourceMode ? 'source editor' : 'timeline'}`, async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const files = ['music', 'voice'].map((name, index) => createWavFixture({
		name: `${name}.wav`, frequency: index ? 1000 : 330, duration: 2,
		channelCount: 1, channelAmplitudes: [0.35], sampleRate: index ? 48_000 : 24_000,
	}));
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-track-row]').first().locator('.track-control-panel__track-name-text').click();
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Remove tracks']);
	await importFiles(editor, files);
	const voice = clipByName(editor, 'voice.wav');
	await voice.locator('xpath=ancestor::div[@data-track-row]').getByRole('button', { name: 'Mute', exact: true }).click();
	const music = clipByName(editor, 'music.wav');
	const properties = sourceMode ? await openClipProperties(page, editor, music) : null;
	if (properties) {
		const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
		await waveform.focus();
		await waveform.press('Control+a');
	} else await music.locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const manager = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await manager.getByRole('button', { name: 'New macro', exact: true }).click();
	await manager.getByRole('button', { name: 'Add effect', exact: true }).click();
	await page.getByRole('menu', { name: 'Choose an effect', exact: true }).getByRole('menuitem', { name: 'Auto Duck', exact: true }).click();
	await manager.getByRole('button', { name: 'Run macro', exact: true }).click();
	await expect(manager).toContainText('Macro applied.', { timeout: 20_000 });
	await manager.getByRole('button', { name: 'Close', exact: true }).click();
	if (properties) await closeClipProperties(properties);
	const output = await exportSamples(page, editor);
	const peak = output.slice(33_600, 38_400).reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
	expect(peak).toBeGreaterThan(0.04);
	expect(peak).toBeLessThan(0.08);
});
