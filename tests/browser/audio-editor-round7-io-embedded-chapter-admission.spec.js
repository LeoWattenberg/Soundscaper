/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile, unlink } from 'node:fs/promises';
import { expect, test, createWavFixture } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog,
} from './audio-editor-test-helpers.js';

async function chapterDialog(page, labelText) {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Programme.wav', duration: 0.5, frequency: 330 })]);
	await importFiles(editor, [{ name: 'Programme-labels.txt', mimeType: 'text/plain', buffer: Buffer.from(labelText) }]);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'MP3');
	await dialog.getByRole('checkbox', { name: 'Include effect tails up to 10 seconds', exact: true }).uncheck();
	return { dialog, editor };
}

test('an end-point chapter cannot be selected for an empty delivered chapter span', async ({ page }) => {
	const { dialog } = await chapterDialog(page, '0.5\t0.5\tEnd of programme\n');
	const chapters = dialog.getByRole('checkbox', { name: 'Embed labels as chapters', exact: true });
	if (await chapters.isEnabled()) {
		await chapters.check();
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		await expect(page.locator('[data-editor-toast]')).toContainText('No labels occur in the exported range.');
	}
	await expect(chapters).toBeDisabled();
});

test('an in-range chapter still delivers an ordinary chapter-bearing MP3', async ({ page }) => {
	const { dialog } = await chapterDialog(page, '0\t0\tOpening\n');
	await dialog.getByRole('checkbox', { name: 'Embed labels as chapters', exact: true }).check();
	const downloaded = page.waitForEvent('download');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = await downloaded;
	const path = await download.path();
	expect(path).not.toBeNull();
	let bytes;
	try { bytes = await readFile(path); } finally { await unlink(path); }
	expect(bytes.subarray(0, 3).toString('ascii')).toBe('ID3');
	for (const text of ['CHAP', 'Opening']) expect(bytes.includes(Buffer.from(text))).toBe(true);
});
