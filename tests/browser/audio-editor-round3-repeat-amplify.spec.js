/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName,
	disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

const loud = createWavFixture({ name: 'repeat-loud.wav', frequency: 330, channelCount: 1, channelAmplitudes: [0.35] });
const quiet = createWavFixture({ name: 'repeat-quiet.wav', frequency: 330, channelCount: 1, channelAmplitudes: [0.175] });

test('Repeat last effect retains its Amplify gain after a new dialog is canceled', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [loud, quiet]);
	const original = clipByName(editor, loud.name);
	const trackId = await original.locator('xpath=ancestor::div[@data-track-row]').getAttribute('data-track-id');
	await original.locator('.clip-header__name').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await expect(dialog.getByRole('button', { name: 'Apply to selection', exact: true })).toBeEnabled();
	const gain = dialog.getByRole('spinbutton', { name: 'Amplification (dB)', exact: true });
	await expect.poll(async () => Number(await gain.inputValue())).toBeCloseTo(9.12, 2);
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden();
	await editor.locator(`[data-track-row][data-track-id="${trackId}"]`).getByRole('button', { name: 'Mute', exact: true }).click();
	await clipByName(editor, quiet.name).locator('.clip-header__name').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Volume and compression', 'Amplify']);
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
	await chooseCommandAction(page, editor, 'Effect', 'Repeat last effect');
	await expect(editor.getByRole('button', { name: 'Export audio', exact: true })).toBeEnabled();
	const samples = await exportSamples(page, editor);
	const peak = samples.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
	expect(peak).toBeGreaterThan(0.35);
	expect(peak).toBeLessThan(0.36);
});
