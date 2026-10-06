/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB, monoTone } from './audio-editor-test-fixtures.js';
import {
	bootEditor, clipByName, importFiles, chooseCommandAction, chooseNestedCommandAction,
	openClipProperties, clipField, closeClipProperties,
	disableNativeSavePicker, openExportDialog, chooseDropdown, readDownloadBytes, closeDialog,
} from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('duplicating a grouped track creates independent clip groups', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	const first = clipByName(editor, toneA.name);
	const second = clipByName(editor, toneB.name);
	await first.locator('.clip-header').click();
	await second.locator('.clip-header').click({ modifiers: ['Shift'] });
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Group clips']);
	await chooseTrackMenuAction(page, editor, first.locator('xpath=ancestor::div[@data-track-row][1]'), 'Duplicate track');
	const copies = clipByName(editor, toneA.name);
	await expect(copies).toHaveCount(2);
	await copies.nth(1).locator('.clip-header').click();
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(1);
});

test('Silence preserves disjoint grouped clips and the unselected clip between them', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await clipByName(editor, monoTone.name).locator('.clip-header').click();
	await chooseCommandAction(page, editor, 'Edit', 'Copy');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Paste', 'Paste']);
	const clips = clipByName(editor, monoTone.name);
	await expect(clips).toHaveCount(3);
	const ids = await clips.evaluateAll((items) => items.map((item) => item.getAttribute('data-clip-id')));
	const clipAt = (index) => editor.locator(`[data-clip-id="${ids[index]}"]`);
	for (const [index, frame] of [[1, '48000'], [2, '96000']]) {
		const properties = await openClipProperties(page, editor, clipAt(index));
		await properties.getByText('Media settings', { exact: true }).click();
		await clipField(properties, 'startFrame').fill(frame);
		await clipField(properties, 'startFrame').press('Tab');
		await closeClipProperties(properties);
	}
	await clipAt(0).locator('.clip-header').click();
	await clipAt(2).locator('.clip-header').click({ modifiers: ['Shift'] });
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Group clips']);
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
	await chooseNestedCommandAction(page, editor, 'Edit', ['Remove special', 'Silence audio']);
	await expect(editor.locator('[data-editor-task-progress]')).toBeHidden();
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
	await chooseDropdown(page, dialog.locator('[data-export-field="dither"]'), 'None');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const bytes = Buffer.from(await readDownloadBytes(page, link));
	const format = bytes.indexOf(Buffer.from('fmt '));
	const data = bytes.indexOf(Buffer.from('data'));
	expect(format).toBeGreaterThan(0);
	expect(data).toBeGreaterThan(0);
	const blockAlign = bytes.readUInt16LE(format + 20);
	expect(blockAlign).toBeGreaterThan(0);
	expect(bytes.readUInt32LE(data + 4)).toBeGreaterThanOrEqual(131_000 * blockAlign);
	const windowBytes = (startFrame, endFrame) => bytes.subarray(data + 8 + startFrame * blockAlign, data + 8 + endFrame * blockAlign);
	expect(windowBytes(1_000, 35_000).every((value) => value === 0)).toBe(true);
	expect(windowBytes(49_000, 83_000).some((value) => value !== 0)).toBe(true);
	expect(windowBytes(97_000, 131_000).every((value) => value === 0)).toBe(true);
	await closeDialog(dialog);
	await expect(editor.locator('[data-clip-id]')).toHaveCount(3);
	for (const index of [0, 1, 2]) await expect(clipAt(index)).toBeVisible();
	await expect(editor.locator('.clip-display[data-selected="true"]')).toHaveCount(2);
});
