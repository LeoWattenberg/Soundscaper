/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, closeClipProperties,
	disableNativeSavePicker, importFiles, openClipProperties } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

function recording(lfe) {
	const fixture = createWavFixture({ name: `surround-${lfe ? 'with' : 'without'}-lfe.wav`,
		frequency: 1000, duration: 1, channelCount: 6, sampleRate: 48_000 });
	for (let frame = 0; frame < 48_000; frame += 1) {
		for (let channel = 0; channel < 6; channel += 1) {
			const value = channel === 0 ? .1 * Math.sin(2 * Math.PI * 1000 * frame / 48_000)
				: channel === 3 && lfe ? .4 * Math.sin(2 * Math.PI * 100 * frame / 48_000) : 0;
			fixture.buffer.writeInt16LE(Math.round(value * 32_767), 44 + (frame * 6 + channel) * 2);
		}
	}
	return fixture;
}

function rms(samples) {
	const body = samples.slice(9600, 38_400);
	return Math.sqrt(body.reduce((sum, sample) => sum + sample * sample, 0) / body.length);
}

test('Source Loudness Normalization gives the same audible programme gain with or without LFE', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording(false), recording(true)]);
	const tracks = [];
	for (const name of ['surround-without-lfe.wav', 'surround-with-lfe.wav']) {
		const id = await clipByName(editor, name).locator('xpath=ancestor::div[@data-track-row]').getAttribute('data-track-id');
		tracks.push(editor.locator(`[data-track-row][data-track-id="${id}"]`));
	}
	await tracks[1].getByRole('button', { name: 'Mute', exact: true }).click();
	const outputs = [];
	for (const [index, track] of tracks.entries()) {
		const properties = await openClipProperties(page, editor, track.locator('[data-clip-id]').first());
		const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
		await waveform.focus();
		await waveform.press('Control+a');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Loudness Normalization']);
		const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(effect).toBeHidden({ timeout: 20_000 });
		await closeClipProperties(properties);
		outputs.push(await exportSamples(page, editor));
		if (index === 0) {
			await tracks[0].getByRole('button', { name: 'Mute', exact: true }).click();
			await tracks[1].getByRole('button', { name: 'Mute', exact: true }).click();
		}
	}
	console.log('5.1 normalized audible programme RMS', outputs.map(rms));
	expect(rms(outputs[1]) / rms(outputs[0])).toBeCloseTo(1, 3);
});
