/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, closeDialog, commitInput,
	disableNativeSavePicker, importFiles, openEffectsForTrack } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('Include tails completes the ordinary Noise Reduction spectral release', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'steady noise recording.wav', frequency: 1000,
		duration: 1, channelCount: 1, channelAmplitudes: [.2] })]);
	const dry = await exportSamples(page, editor);
	expect(dry.length).toBe(48_000);
	expect(Math.max(...dry.slice(40_000, 47_000).map(Math.abs))).toBeGreaterThan(.13);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Noise Reduction');
	const dialog = page.getByRole('dialog', { name: 'Noise Reduction', exact: true });
	await dialog.getByRole('button', { name: 'Get noise profile', exact: true }).click();
	await expect(dialog.getByRole('button', { name: 'Replace noise profile', exact: true })).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Disable effect', exact: true })).toBeVisible();
	await commitInput(dialog.locator('[data-effect-param="reductionDb"] input[type="number"]'), '0');
	await closeDialog(dialog);
	const neutral = await exportSamples(page, editor);
	expect(neutral.length).toBe(48_000);
	expect(Math.max(...neutral.slice(40_000, 47_000).map(Math.abs))).toBeGreaterThan(.13);
	const slot = panel.getByRole('group', { name: 'Noise Reduction', exact: true });
	await slot.getByRole('button', { name: 'Select effect', exact: true }).click();
	await commitInput(dialog.locator('[data-effect-param="reductionDb"] input[type="number"]'), '24');
	await commitInput(dialog.locator('[data-effect-param="frequencySmoothingBands"] input[type="number"]'), '3');
	await closeDialog(dialog);
	const wet = await exportSamples(page, editor);
	expect(wet.length).toBeGreaterThan(48_128);
	expect(Math.max(...wet.slice(48_000, 48_128).map(Math.abs))).toBeGreaterThan(.005);
	expect(Math.max(...wet.slice(-128).map(Math.abs))).toBeLessThan(.0001);
	await slot.getByRole('button', { name: 'Disable effect', exact: true }).click();
	const bypassed = await exportSamples(page, editor);
	expect(bypassed.length).toBe(48_000);
	expect(Math.max(...bypassed.slice(40_000, 47_000).map(Math.abs))).toBeGreaterThan(.13);
});
