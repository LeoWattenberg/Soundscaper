/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('Nyquist source selection properties use the source sample clock', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = createWavFixture({ name: 'nyquist-native.wav', frequency: 1000,
		duration: 0.8, channelCount: 1, sampleRate: 44_100 });
	await importFiles(editor, [recording]);
	const panel = await openClipProperties(page, editor, clipByName(editor, recording.name));
	const waveform = panel.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus();
	await waveform.press('Control+a');
	await expect(waveform.locator('.audio-editor-source-selection')).toBeVisible();
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
	await dialog.getByRole('textbox', { name: 'Nyquist source', exact: true }).fill(
		"(format nil \"~a\" (- (get '*selection* 'end) (get '*selection* 'start)))",
	);
	await dialog.getByRole('button', { name: 'Run', exact: true }).click();
	const output = dialog.locator('.kw-audio-editor__nyquist-output');
	await expect(output).toContainText('0.8', { timeout: 20_000 });
});
