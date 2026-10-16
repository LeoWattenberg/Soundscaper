/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, closeDialog, commitInput, disableNativeSavePicker,
	importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Export includes the audible release of a Classic Filters rack insert', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'low frequency recording.wav', sampleRate: 48_000,
		frequency: 10, duration: 1, channelCount: 2, channelAmplitudes: [.5, .5] })]);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Classic Filters');
	const dialog = page.getByRole('dialog', { name: 'Classic Filters', exact: true });
	await commitInput(dialog.getByRole('spinbutton', { name: 'Cutoff frequency (Hz)', exact: true }), '10');
	await closeDialog(dialog);
	const samples = await exportSamples(page, editor);
	expect(samples.length).toBeGreaterThan(48_128);
	expect(Math.max(...samples.slice(48_000, 48_128).map(Math.abs))).toBeGreaterThan(.1);
	expect(Math.max(...samples.slice(-128).map(Math.abs))).toBeLessThan(.0001);
});
