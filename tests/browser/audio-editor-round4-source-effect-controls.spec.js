/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, commitInput,
	importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('source effect frequency controls use the selected recording sample rate', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'telephone-recording.wav', sampleRate: 11_025,
		frequency: 1000, duration: 0.8, channelCount: 1 });
	await importFiles(editor, [recording]);
	const properties = await openClipProperties(page, editor, clipByName(editor, recording.name));
	const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus();
	await waveform.press('Control+a');
	await expect(waveform.locator('.audio-editor-source-selection')).toBeVisible();
	await chooseNestedCommandAction(page, editor, 'Effect', ['EQ and filters', 'High-pass filter']);
	const effect = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	const cutoff = effect.getByRole('spinbutton', { name: 'Cutoff frequency', exact: true });
	await commitInput(cutoff, '6000');
	await expect(cutoff).toHaveAttribute('aria-invalid', 'true');
	await commitInput(cutoff, '5512.4');
	await expect(cutoff).toHaveValue('5512.4');
	await effect.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(effect).toBeHidden({ timeout: 20_000 });
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
});
