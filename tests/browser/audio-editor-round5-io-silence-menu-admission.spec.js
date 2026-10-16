/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, chooseNestedCommandAction, clipByName, disableNativeSavePicker, getMenuItem, importFiles,
	openExportDialog, openNestedCommandMenu, readDownloadBytes,
} from './audio-editor-test-helpers.js';

test('Framescaper does not offer its unsupported Silence audio mutation', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'dialogue.wav', frequency: 440, duration: 1, channelCount: 1 })]);
	await clipByName(editor, 'dialogue.wav').press('Enter');
	const menu = await openNestedCommandMenu(page, editor, 'Edit', ['Remove special']);
	await expect(getMenuItem(menu, 'Trim audio outside selection')).toBeEnabled();
	await expect(getMenuItem(menu, 'Silence audio')).toBeDisabled();
});

test('Soundscaper still silences ordinary selected audio through its Edit menu', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'programme.wav', frequency: 440, duration: 1, channelCount: 1 })]);
	await clipByName(editor, 'programme.wav').press('Enter');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Remove special', 'Silence audio']);
	await expect(editor.locator('[data-editor-task-progress]')).toBeHidden();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const delivery = await openExportDialog(page, editor);
	await chooseDropdown(page, delivery.locator('[data-export-field="format"]'), 'WAV');
	await chooseDropdown(page, delivery.locator('[data-export-field="dither"]'), 'None');
	await delivery.getByRole('button', { name: 'Export', exact: true }).click();
	const download = delivery.locator('[data-export-download]');
	await expect(download).toBeVisible({ timeout: 20_000 });
	const bytes = Buffer.from(await readDownloadBytes(page, download));
	const data = bytes.indexOf(Buffer.from('data'));
	expect(data).toBeGreaterThan(0);
	const count = bytes.readUInt32LE(data + 4);
	expect(count).toBeGreaterThan(0);
	expect(bytes.subarray(data + 8, data + 8 + count).every(value => value === 0)).toBe(true);
});
