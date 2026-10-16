/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, clipByName,
	disableNativeSavePicker, downloadBytes, importFiles } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

for (const emptyChild of [false, true]) test(`DAWproject export and Open retain ${emptyChild ? 'an empty child and its populated parent' : 'a populated folder'}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	const recording = clipByName(editor, monoTone.name);
	const track = recording.locator('xpath=ancestor::div[@data-track-row][1]');
	await recording.locator('.clip-header').click();
	await chooseTrackMenuAction(page, editor, track, 'Move selection into new folder');
	const parent = editor.getByRole('treeitem', { name: 'Folder Folder 1, level 1', exact: true });
	await expect(parent).toBeVisible();
	if (emptyChild) {
		await parent.click({ button: 'right', position: { x: 40, y: 12 } });
		await page.getByRole('menuitem', { name: 'New folder', exact: true }).click();
		await expect(editor.getByRole('treeitem', { name: 'Folder Folder 2, level 2', exact: true })).toBeVisible();
	}
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const download = await downloading;
	let bytes;
	try { bytes = await downloadBytes(download); } finally { await download.delete(); }
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: download.suggestedFilename(), mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported', { timeout: 30_000 });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const importedRecording = clipByName(editor, monoTone.name.replace(/\.wav$/u, ''));
	await expect(importedRecording).toHaveAttribute('aria-label', 'browser-mono-tone clip, starts at 0 seconds, 0.8 seconds long');
	await expect(parent).toBeVisible();
	await expect(editor.locator('[data-track-folder-row]')).toHaveCount(emptyChild ? 2 : 1);
	if (emptyChild) await expect(editor.getByRole('treeitem', { name: 'Folder Folder 2, level 2', exact: true })).toBeVisible();
	await parent.getByRole('button', { name: 'Collapse folder', exact: true }).click();
	await expect(importedRecording).toHaveCount(0);
	await expect(editor.locator('[data-track-row]')).toHaveCount(1);
	if (emptyChild) await expect(editor.locator('[data-track-folder-row]')).toHaveCount(1);
	await parent.getByRole('button', { name: 'Expand folder', exact: true }).click();
	await expect(importedRecording).toHaveCount(1);
	await expect(editor.locator('[data-track-row]')).toHaveCount(2);
});
