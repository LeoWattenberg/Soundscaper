/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, importFiles, openExportDialog, chooseDropdown, readDownloadBytes, closeDialog, disableNativeSavePicker } from './audio-editor-test-helpers.js';

test('Tone defaults to the selected duration', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const dialog = page.getByRole('dialog', { name: 'Tone', exact: true });
	await expect(dialog.getByRole('group', { name: 'Duration (seconds)', exact: true }).locator('.timecode__display')).toHaveText('00h00m00.800s');
});

test('Tone also reads the duration of a clip selected through its header', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await clipByName(editor, toneA.name).locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const dialog = page.getByRole('dialog', { name: 'Tone', exact: true });
	await expect(dialog.getByRole('group', { name: 'Duration (seconds)', exact: true }).locator('.timecode__display')).toHaveText('00h00m00.800s');
});

test('a generator knob changes by one step for one arrow key press', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Morse code');
	const dialog = page.getByRole('dialog', { name: 'Morse code', exact: true });
	const knob = dialog.getByRole('slider').first();
	const initial = Number(await knob.getAttribute('aria-valuenow'));
	await knob.focus();
	await knob.press('ArrowUp');
	await expect(knob).toHaveAttribute('aria-valuenow', String(initial + 1));
	await knob.press('Home');
	await expect(knob).toHaveAttribute('aria-valuenow', '5');
	await knob.press('End');
	await expect(knob).toHaveAttribute('aria-valuenow', '60');
});

test('generator frequency entries respect the project Nyquist limit', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const dialog = page.getByRole('dialog', { name: 'Tone', exact: true });
	const frequency = dialog.getByRole('textbox', { name: 'Frequency (Hz)', exact: true });
	await frequency.fill('30000');
	await frequency.blur();
	await expect(frequency).toHaveValue('24000');
});

test('editing generator amplitude cannot leave an out-of-range value', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Generate', 'Tone');
	const dialog = page.getByRole('dialog', { name: 'Tone', exact: true });
	const amplitude = dialog.getByRole('textbox', { name: 'Amplitude', exact: true });
	await amplitude.fill('1.5');
	await amplitude.blur();
	await expect(amplitude).toHaveValue('1');
});

test('Silence audio applies to every selected audio track', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Remove special', 'Silence audio']);
	await expect(editor.locator('[data-editor-task-progress]')).toBeHidden();
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await chooseDropdown(page, dialog.locator('[data-export-field="dither"]'), 'None');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const bytes = Buffer.from(await readDownloadBytes(page, link));
	const data = bytes.indexOf(Buffer.from('data'));
	expect(data).toBeGreaterThan(0);
	const length = bytes.readUInt32LE(data + 4);
	expect(bytes.subarray(data + 8, data + 8 + length).every((value) => value === 0)).toBe(true);
	await closeDialog(dialog);
});
