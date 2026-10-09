/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, commitInput,
	disableNativeSavePicker, importFiles } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const effect of [
	{ name: 'Change tempo', parameter: 'tempoPercent' },
	{ name: 'Change speed and pitch', parameter: 'speedPercent' },
]) test(`${effect.name} shows the actual delivered duration in its ordinary Samples format`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'one-second-recording.wav', duration: 1,
		frequency: 440, sampleRate: 48_000, channelCount: 1, channelAmplitudes: [.3] })]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', effect.name]);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	const percent = dialog.locator(`[data-effect-param="${effect.parameter}"] input[type="number"]`);
	const desired = dialog.locator('[data-effect-param="effectAudacityNewLength"]');
	await commitInput(percent, '100');
	await desired.getByRole('button', { name: /Desired duration.*format/u }).click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	const displayedFrames = async () => Number((await desired.locator('.timecode__display').textContent()).replace(/\D/gu, ''));
	await expect.poll(displayedFrames).toBe(24_000);
	await commitInput(percent, '50');
	await expect(percent).toHaveValue('50');
	const claimedFrames = await displayedFrames();
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 });
	const output = await exportSamples(page, editor);
	expect(output.length).toBe(32_000);
	console.log('Ordinary rate effect duration', { effect: effect.name, claimedFrames, deliveredFrames: output.length });
	expect(claimedFrames).toBe(output.length);
});
