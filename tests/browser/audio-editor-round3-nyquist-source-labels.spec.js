/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('Nyquist labels from a source selection retain its clip placement', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const panel = await openClipProperties(page, editor, clipByName(editor, toneA.name));
	await panel.getByText('Media settings', { exact: true }).click();
	const start = panel.locator('[data-clip-field="startFrame"]');
	await start.locator('.timecode-digit').first().click();
	await page.keyboard.type('000001000');
	await page.keyboard.press('Enter');
	await expect(start.locator('.timecode__display')).toHaveText('00h00m01.000s');
	const waveform = panel.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus();
	await waveform.press('Control+a');
	await expect(waveform.locator('.audio-editor-source-selection')).toBeVisible();
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
	await dialog.getByRole('textbox', { name: 'Nyquist source', exact: true }).fill("'((0.2 0.4 \"Analysis\"))");
	await dialog.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(dialog.locator('.kw-audio-editor__nyquist-output')).toContainText('label(s)', { timeout: 30_000 });
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await chooseCommandAction(page, editor, 'Edit', 'Manage labels');
	const labels = editor.locator('[data-workspace-panel="labels"]');
	await expect(labels.locator('.timecode__display').first()).toHaveText('00h00m01.200s');
	await expect(labels.locator('.timecode__display').nth(1)).toHaveText('00h00m01.400s');
});
