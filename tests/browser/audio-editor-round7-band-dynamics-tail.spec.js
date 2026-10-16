/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, closeDialog, commitInput, disableNativeSavePicker,
	importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Include tails retains the audible Multiband compressor crossover release', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'low bass recording.wav', frequency: 40,
		duration: 1, channelCount: 2, channelAmplitudes: [.5, .5] })]);
	const dry = await exportSamples(page, editor);
	expect(dry.length).toBe(48_000);
	expect(Math.max(...dry.slice(47_000, 47_900).map(Math.abs))).toBeGreaterThan(.3);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Multiband compressor');
	const dialog = page.getByRole('dialog', { name: 'Multiband compressor', exact: true });
	for (const [parameter, value] of [['lowCrossover', '40'], ['highCrossover', '2500'],
		['lowRatio', '1'], ['midRatio', '1'], ['highRatio', '1'], ['lowGain', '12'], ['midGain', '-12']]) {
		await commitInput(dialog.locator(`[data-effect-param="${parameter}"] input[type="number"]`), value);
	}
	await closeDialog(dialog);
	const wet = await exportSamples(page, editor);
	expect(wet.length).toBeGreaterThan(48_128);
	expect(Math.max(...wet.slice(48_000, 48_128).map(Math.abs))).toBeGreaterThan(.1);
	expect(Math.max(...wet.slice(-128).map(Math.abs))).toBeLessThan(.0001);
});
