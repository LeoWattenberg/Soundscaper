/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseNestedCommandAction, clipByName,
	commitInput, disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function recording(channelCount) {
	const rate = 48_000;
	const bands = 10;
	const ratio = 2 ** (Math.log2(rate / 2.205 / 20) / bands);
	const firstFrequency = 20 * Math.sqrt(ratio);
	const fixture = createWavFixture({ name: `${channelCount === 1 ? 'mono' : 'stereo'}-vocoder.wav`,
		frequency: 355, duration: 1, channelCount, sampleRate: rate });
	for (let frame = 0; frame < rate; frame += 1) {
		const modulator = .15 * [355, 1_300, 5_850].reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * frequency * frame / rate), 0);
		fixture.buffer.writeInt16LE(Math.round(modulator * 32_767), 44 + frame * channelCount * 2);
		if (channelCount === 2) {
			let carrier = 0;
			for (let band = 0; band < bands; band += 1) carrier += .5 / bands * Math.sin(2 * Math.PI * firstFrequency * ratio ** band * frame / rate);
			fixture.buffer.writeInt16LE(Math.round(carrier * 32_767), 46 + frame * 4);
		}
	}
	return fixture;
}

function correlation(first, second) {
	let cross = 0;
	let firstPower = 0;
	let secondPower = 0;
	for (let frame = 12_000; frame < 48_000; frame += 1) {
		cross += first[frame] * second[frame];
		firstPower += first[frame] ** 2;
		secondPower += second[frame] ** 2;
	}
	return cross / Math.sqrt(firstPower * secondPower);
}

test('mono Vocoder matches the same complete carrier supplied through an ordinary stereo recording', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording(1), recording(2)]);
	const monoId = await clipByName(editor, 'mono-vocoder.wav').locator('xpath=ancestor::div[@data-track-row]').getAttribute('data-track-id');
	const stereoId = await clipByName(editor, 'stereo-vocoder.wav').locator('xpath=ancestor::div[@data-track-row]').getAttribute('data-track-id');
	const mono = editor.locator(`[data-track-row][data-track-id="${monoId}"]`);
	const stereo = editor.locator(`[data-track-row][data-track-id="${stereoId}"]`);
	await stereo.getByRole('button', { name: 'Mute', exact: true }).click();
	const applyVocoder = async track => {
		await track.locator('.clip-header').click();
		await chooseNestedCommandAction(page, editor, 'Effect', ['Distortion and modulation', 'Vocoder']);
		const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		await commitInput(effect.getByRole('spinbutton', { name: 'Vocoder bands', exact: true }), '10');
		await chooseDropdown(page, effect.getByRole('group', { name: 'Output', exact: true }), 'Vocoded audio');
		await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(effect).toBeHidden({ timeout: 20_000 });
	};
	await applyVocoder(mono);
	const monoOutput = await exportSamples(page, editor);
	await mono.getByRole('button', { name: 'Mute', exact: true }).click();
	await stereo.getByRole('button', { name: 'Mute', exact: true }).click();
	await applyVocoder(stereo);
	const stereoOutput = await exportSamples(page, editor);
	const similarity = correlation(monoOutput, stereoOutput);
	console.log('Equivalent Vocoder carrier export correlation', similarity);
	expect(similarity).toBeGreaterThan(.999);
});
