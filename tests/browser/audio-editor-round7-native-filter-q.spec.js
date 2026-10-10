/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, closeDialog, commitInput, disableNativeSavePicker,
	importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const name of ['Resonant low-pass filter', 'Resonant high-pass filter']) {
	test(`${name} renders the authored default Q at its cutoff`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [createWavFixture({ name: 'resonant cutoff recording.wav', sampleRate: 48_000,
			frequency: 1000, duration: 3, channelCount: 2, channelAmplitudes: [.5, .5] })]);
		const panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', name);
		const dialog = page.getByRole('dialog', { name, exact: true });
		await commitInput(dialog.locator('[data-effect-param="frequency"] input'), '1000');
		await expect(dialog.locator('[data-effect-param="q"] input')).toHaveValue('0.707');
		await closeDialog(dialog);
		const samples = (await exportSamples(page, editor)).slice(48_000, 96_000);
		const rms = Math.sqrt(samples.reduce((power, sample) => power + sample ** 2, 0) / samples.length);
		console.log('ordinary native resonant filter cutoff RMS', { name, measured: rms, expected: .5 * .707 / Math.SQRT2 });
		expect(rms).toBeCloseTo(.5 * .707 / Math.SQRT2, 4);
	});
}
