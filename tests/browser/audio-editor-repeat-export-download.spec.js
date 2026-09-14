/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	expect,
	test,
	toneA,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	closeDialog,
	collectClientErrors,
	disableNativeSavePicker,
	importFiles,
	openExportDialog,
} from './audio-editor-test-helpers.js';

test('downloads an unchanged project once per export across a dialog reopen', async ({ page }) => {
	await disableNativeSavePicker(page);
	const errors = collectClientErrors(page);
	const downloads = [];
	page.on('download', (download) => downloads.push(download.suggestedFilename()));
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);

	let dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect.poll(() => downloads.length, { timeout: 20_000 }).toBe(1);
	await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
	await closeDialog(dialog);

	dialog = await openExportDialog(page, editor);
	await page.waitForTimeout(250);
	expect(downloads).toHaveLength(1);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect.poll(() => downloads.length, { timeout: 20_000 }).toBe(2);
	expect(downloads[1]).toBe(downloads[0]);
	expect(errors).toEqual([]);
});
