/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, closeDialog, commitInput, disableNativeSavePicker,
	importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Include tails retains the actual Parametric EQ low-pass release', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'sub bass recording.wav', frequency: 10,
		duration: 1, channelCount: 2, channelAmplitudes: [.5, .5] })]);
	const dry = await exportSamples(page, editor);
	expect(dry.length).toBe(48_000);
	expect(Math.max(...dry.slice(43_200, 47_000).map(Math.abs))).toBeGreaterThan(.3);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Parametric EQ');
	const dialog = page.getByRole('dialog', { name: 'Parametric EQ', exact: true });
	const band = dialog.getByRole('region', { name: 'Selected band', exact: true });
	await band.getByRole('combobox', { name: 'Type', exact: true }).selectOption('lowpass');
	await commitInput(band.getByRole('spinbutton', { name: 'Frequency (Hz)', exact: true }), '10');
	await band.getByRole('combobox', { name: 'Slope', exact: true }).selectOption('12');
	await closeDialog(dialog);
	const wet = await exportSamples(page, editor);
	expect(wet.length).toBeGreaterThan(48_128);
	expect(Math.max(...wet.slice(48_000, 48_128).map(Math.abs))).toBeGreaterThan(.1);
	expect(Math.max(...wet.slice(-128).map(Math.abs))).toBeLessThan(.0001);
});
