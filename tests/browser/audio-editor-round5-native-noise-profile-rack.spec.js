/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction, closeClipProperties,
	closeDialog, disableNativeSavePicker, importFiles, openClipProperties, openEffectsForTrack } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

test('a native 24 kHz noise profile requires fresh capture before enabling a 48 kHz rack', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'native-noise-24000.wav', sampleRate: 24_000,
		frequency: 750, duration: 0.8, channelCount: 1 })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const properties = await openClipProperties(page, editor, editor.locator('[data-clip-id]').first());
	const source = properties.getByRole('region', { name: 'Source waveform', exact: true });
	await source.focus();
	await source.press('Control+a');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Noise removal and repair', 'Noise Reduction']);
	const selection = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await selection.getByRole('button', { name: 'Get noise profile', exact: true }).click();
	await expect(editor.locator('[data-status]')).toHaveText('Noise profile is ready.', { timeout: 20_000 });
	await selection.getByRole('button', { name: 'Cancel', exact: true }).click();
	await closeClipProperties(properties);
	const panel = await openEffectsForTrack(editor, 1);
	await addRackEffect(page, panel, 'track', 'Noise Reduction');
	const rack = page.getByRole('dialog', { name: 'Noise Reduction', exact: true });
	await closeDialog(rack);
	expect((await exportSamples(page, editor)).length).toBe(38_400);
	await panel.getByRole('group', { name: 'Noise Reduction', exact: true })
		.getByRole('button', { name: 'Select effect', exact: true }).click();
	await expect(rack.getByRole('button', { name: 'Get noise profile', exact: true })).toBeVisible();
	await expect(rack.getByRole('button', { name: 'Enable effect', exact: true })).toBeVisible();
	await rack.getByRole('button', { name: 'Get noise profile', exact: true }).click();
	await expect(rack.getByRole('button', { name: 'Replace noise profile', exact: true })).toBeVisible({ timeout: 20_000 });
	await closeDialog(rack);
	expect((await exportSamples(page, editor)).length).toBe(38_400);
});
