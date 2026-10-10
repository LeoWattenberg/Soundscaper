/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, commitInput,
	disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Classic Filters applies the exact supported cutoff near Nyquist', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'supported 23999 Hz recording.wav', sampleRate: 48_000,
		frequency: 23_999, duration: 4, channelCount: 2, channelAmplitudes: [.5, .5] })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Legacy effects', 'Classic Filters']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await commitInput(dialog.getByRole('spinbutton', { name: 'Cutoff frequency (Hz)', exact: true }), '23999');
	await expect(dialog.getByRole('spinbutton', { name: 'Cutoff frequency (Hz)', exact: true })).toHaveValue('23999');
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden();
	const samples = await exportSamples(page, editor);
	const body = samples.slice(96_000, 192_000);
	const rms = Math.sqrt(body.reduce((power, sample) => power + sample ** 2, 0) / body.length);
	expect(rms).toBeCloseTo(.25, 3);
});
