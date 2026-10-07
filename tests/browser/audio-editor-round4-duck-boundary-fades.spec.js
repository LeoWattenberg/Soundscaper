/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseNestedCommandAction, clipByName,
	disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Auto Duck keeps attenuation while voice spans both selection boundaries', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const files = ['music', 'voice'].map((name, index) => createWavFixture({
		name: `${name}.wav`, frequency: index ? 1000 : 330, duration: 3,
		channelCount: 1, channelAmplitudes: [0.35],
	}));
	await importFiles(editor, files);
	await clipByName(editor, 'voice.wav').locator('xpath=ancestor::div[@data-track-row]')
		.getByRole('button', { name: 'Mute', exact: true }).click();
	await clipByName(editor, 'music.wav').locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Auto Duck']);
	const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await chooseDropdown(page, effect.getByRole('group', { name: 'Control track', exact: true }), 'voice');
	await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(effect).toBeHidden({ timeout: 20_000 });
	const samples = await exportSamples(page, editor);
	for (const start of [4800, 134400]) {
		const peak = samples.slice(start, start + 2400)
			.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
		expect(peak).toBeGreaterThan(0.04);
		expect(peak).toBeLessThan(0.08);
	}
});
