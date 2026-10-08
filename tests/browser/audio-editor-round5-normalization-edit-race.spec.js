/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, closeDialog, disableNativeSavePicker, importFiles, openClipProperties, openExportDialog } from './audio-editor-test-helpers.js';

test('a later explicit clip gain edit survives an in-progress normalization', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const recording = createWavFixture({ name: 'long-room-tone.wav', frequency: 440,
		duration: 30, channelCount: 1, channelAmplitudes: [0.1] });
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [recording]);
	const properties = await openClipProperties(page, editor, clipByName(editor, recording.name));
	await properties.getByText('Normalize', { exact: true }).click();
	const gain = properties.getByRole('spinbutton', { name: 'Clip gain (dB)', exact: true });
	await properties.getByRole('button', { name: 'Normalize to −1 dBFS', exact: true }).click();
	await gain.fill('-6');
	await gain.press('Enter');
	await expect(gain).toHaveValue('-6.00');
	const exporting = await openExportDialog(page, editor);
	await exporting.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(exporting.locator('[data-export-download]')).toBeVisible({ timeout: 30_000 });
	await closeDialog(exporting);
	await expect(gain).toHaveValue('-6.00');
});
