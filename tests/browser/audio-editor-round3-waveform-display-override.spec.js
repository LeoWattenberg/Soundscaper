/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('a track can choose Waveform while the Spectrogram tool is enabled', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	const clip = clipByName(editor, toneA.name);
	const row = clip.locator('xpath=ancestor::div[@data-track-row]');
	const peer = clipByName(editor, toneB.name).locator('xpath=ancestor::div[@data-track-row]');
	await expect(row).toHaveAttribute('data-display-mode', 'spectrogram');
	await expect(peer).toHaveAttribute('data-display-mode', 'spectrogram');
	await chooseTrackMenuAction(page, editor, row, ['Track visualization', 'Waveform']);
	await expect(row).toHaveAttribute('data-display-mode', 'waveform');
	await expect(peer).toHaveAttribute('data-display-mode', 'spectrogram');
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(row).toHaveAttribute('data-display-mode', 'spectrogram');
	await expect(peer).toHaveAttribute('data-display-mode', 'spectrogram');
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(row).toHaveAttribute('data-display-mode', 'waveform');
	await expect(peer).toHaveAttribute('data-display-mode', 'spectrogram');
});
