/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, closeDialog, commitInput, disableNativeSavePicker,
	importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Include tails completes the ordinary Phaser feedback release', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'phaser bass recording.wav', frequency: 40,
		duration: 1, channelCount: 2, channelAmplitudes: [.1, .1] })]);
	const dry = await exportSamples(page, editor);
	expect(dry.length).toBe(48_000);
	expect(Math.max(...dry.slice(43_200, 47_000).map(Math.abs))).toBeGreaterThan(.08);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Phaser');
	const dialog = page.getByRole('dialog', { name: 'Phaser', exact: true });
	for (const [label, value] of [['Depth', '0'], ['Feedback (%)', '100'],
		['Dry/wet', '255'], ['Output gain (dB)', '-30']]) {
		await commitInput(dialog.getByRole('spinbutton', { name: label, exact: true }), value);
	}
	await closeDialog(dialog);
	const slot = panel.getByRole('group', { name: 'Phaser', exact: true });
	await slot.getByRole('button', { name: 'Disable effect', exact: true }).click();
	const bypassed = await exportSamples(page, editor);
	expect(bypassed.length).toBe(48_000);
	expect(Math.max(...bypassed.slice(43_200, 47_000).map(Math.abs))).toBeGreaterThan(.08);
	await slot.getByRole('button', { name: 'Enable effect', exact: true }).click();
	const wet = await exportSamples(page, editor);
	expect(wet.length).toBeGreaterThan(48_128);
	expect(Math.max(...wet.slice(48_000, 48_128).map(Math.abs))).toBeGreaterThan(.05);
	expect(Math.max(...wet.slice(-128).map(Math.abs))).toBeLessThan(.0001);
});
