/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('Nyquist source labels keep the sound position within a repeated clip', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const clip = clipByName(editor, monoTone.name);
	await clip.locator('.clip-header').click();
	await clip.getByRole('slider', { name: 'Looped clip length', exact: true }).press('ArrowRight');
	await expect(clip).toHaveAccessibleName(/1\.6 seconds long$/u);
	const properties = await openClipProperties(page, editor, clip);
	const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus();
	await waveform.press('Control+a');
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
	await dialog.getByRole('textbox', { name: 'Nyquist source', exact: true }).fill('\'((0.2 0.4 "Source cue"))');
	await dialog.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(dialog.locator('.kw-audio-editor__nyquist-output')).toContainText('label(s)', { timeout: 20_000 });
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
	const labels = editor.locator('[data-workspace-panel="labels"]');
	await expect(labels.locator('.timecode__display').first()).toHaveText('00h00m00.200s');
	await expect(labels.locator('.timecode__display').nth(1)).toHaveText('00h00m00.400s');
});
