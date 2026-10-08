/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('Nyquist source processing receives the tempo at its placed clip', async ({ page }) => {
	const editor = await bootEditor(page, '/en/');
	await page.locator('[data-sidebar] [data-workspace-select]').selectOption('music');
	await importFiles(editor, [monoTone]);
	await editor.getByRole('button', { name: 'Musical timeline', exact: true }).click();
	const musical = page.getByRole('dialog', { name: 'Musical timeline', exact: true });
	await musical.getByRole('button', { name: 'Add tempo event', exact: true }).click();
	const event = musical.getByRole('form', { name: 'Tempo event 2', exact: true });
	await event.getByRole('spinbutton', { name: 'Beat position numerator', exact: true }).fill('8');
	await event.getByRole('spinbutton', { name: 'Tempo (BPM) numerator', exact: true }).fill('90');
	await event.getByRole('spinbutton', { name: 'Tempo (BPM) denominator', exact: true }).fill('1');
	await event.getByRole('button', { name: 'Save', exact: true }).click();
	await page.keyboard.press('Escape');
	await expect(musical).toBeHidden();
	const properties = await openClipProperties(page, editor, clipByName(editor, monoTone.name));
	await properties.getByText('Media settings', { exact: true }).click();
	const start = properties.locator('[data-clip-field="startFrame"]');
	await start.locator('.timecode-digit').first().click();
	await page.keyboard.type('000005000');
	await page.keyboard.press('Enter');
	await expect(start.locator('.timecode__display')).toHaveText('00h00m05.000s');
	const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus();
	await waveform.press('Control+a');
	await expect(waveform.locator('.audio-editor-source-selection')).toBeVisible();
	await chooseCommandAction(page, editor, 'Tools', 'Nyquist prompt');
	const dialog = page.getByRole('dialog', { name: 'Nyquist prompt', exact: true });
	await dialog.getByRole('textbox', { name: 'Nyquist source', exact: true }).fill('(format nil "~a" (get \'*project* \'tempo))');
	await dialog.getByRole('button', { name: 'Run', exact: true }).click();
	await expect(dialog.locator('.kw-audio-editor__nyquist-output')).toContainText('90', { timeout: 20_000 });
});
