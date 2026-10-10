/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, closeDialog, commitInput, disableNativeSavePicker,
	importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const { name, frequency, controls } of [
	{ name: 'Bass and Treble', frequency: 40, controls: [['Bass (dB)', '30'], ['Output volume (dB)', '-30']] },
	{ name: 'Wahwah', frequency: 60, controls: [['LFO frequency (Hz)', '0.1'], ['Depth (%)', '0'],
		['Resonance', '10'], ['Frequency offset (%)', '0'], ['Output gain (dB)', '-24']] },
]) {
	test(`Include tails retains the ordinary ${name} filter release`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: `${name} bass recording.wav`, frequency,
			duration: 1, channelCount: 2, channelAmplitudes: [.5, .5] })]);
		const dry = await exportSamples(page, editor);
		expect(dry.length).toBe(48_000);
		expect(Math.max(...dry.slice(43_200, 47_000).map(Math.abs))).toBeGreaterThan(.3);
		const panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', name);
		const dialog = page.getByRole('dialog', { name, exact: true });
		for (const [label, value] of controls) {
			await commitInput(dialog.getByRole('spinbutton', { name: label, exact: true }), value);
		}
		await closeDialog(dialog);
		const slot = panel.getByRole('group', { name, exact: true });
		await slot.getByRole('button', { name: 'Disable effect', exact: true }).click();
		const bypassed = await exportSamples(page, editor);
		expect(bypassed.length).toBe(48_000);
		expect(Math.max(...bypassed.slice(43_200, 47_000).map(Math.abs))).toBeGreaterThan(.3);
		await slot.getByRole('button', { name: 'Enable effect', exact: true }).click();
		const wet = await exportSamples(page, editor);
		expect(wet.length).toBeGreaterThan(48_128);
		expect(Math.max(...wet.slice(48_000, 48_128).map(Math.abs))).toBeGreaterThan(.1);
		expect(Math.max(...wet.slice(-128).map(Math.abs))).toBeLessThan(.0001);
	});
}
