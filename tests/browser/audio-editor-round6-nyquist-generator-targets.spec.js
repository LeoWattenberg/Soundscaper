/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, disableNativeSavePicker,
	importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const selection of ['headers', 'range']) test(`a Nyquist generator replaces both recording tracks selected by ${selection}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const first = createWavFixture({ name: 'first-microphone.wav', frequency: 1000,
		duration: 1, channelCount: 1, channelAmplitudes: [.2] });
	const second = createWavFixture({ name: 'second-microphone.wav', frequency: 2000,
		duration: 1, channelCount: 1, channelAmplitudes: [.2] });
	await importFiles(editor, [first, second]);
	await clipByName(editor, first.name).locator('.clip-header').click();
	await clipByName(editor, second.name).locator('.clip-header').click({ modifiers: ['Shift'] });
	if (selection === 'range') await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Generate', ['Nyquist', 'Risset Drum']);
	const dialog = page.getByRole('dialog', { name: 'Risset Drum', exact: true });
	await dialog.getByRole('spinbutton', { name: /^Decay \(seconds\)/u }).fill('1');
	await dialog.getByRole('spinbutton', { name: /^Amount of noise in mix \(percent\)/u }).fill('0');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	const samples = await exportSamples(page, editor);
	expect(toneAmplitude(samples, 100)).toBeGreaterThan(.02);
	expect(toneAmplitude(samples, 1000)).toBeLessThan(.005);
	expect(toneAmplitude(samples, 2000)).toBeLessThan(.005);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await exportSamples(page, editor);
	expect(toneAmplitude(restored, 1000)).toBeGreaterThan(.13);
	expect(toneAmplitude(restored, 2000)).toBeGreaterThan(.13);
});

function toneAmplitude(samples, frequency) {
	const middle = samples.slice(4800, 33_600);
	let sine = 0;
	let cosine = 0;
	for (const [frame, sample] of middle.entries()) {
		const angle = 2 * Math.PI * frequency * frame / 48_000;
		sine += sample * Math.sin(angle);
		cosine += sample * Math.cos(angle);
	}
	return 2 * Math.hypot(sine, cosine) / middle.length;
}
