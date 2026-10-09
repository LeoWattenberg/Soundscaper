/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, chooseFileAction, chooseNestedCommandAction,
	commitInput, disableNativeSavePicker, importFiles, openExportDialog,
} from './audio-editor-test-helpers.js';

async function renameProject(page, editor, title) {
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await commitInput(dialog.locator('[data-project-name-input] input'), title);
	await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(editor.locator('[data-project-name]')).toHaveText(title);
}

async function saveReport(page, editor) {
	await chooseFileAction(page, editor, 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report.locator('[data-delivery-report]')).toContainText(/wav/iu);
	const reportDownload = page.waitForEvent('download');
	await report.getByRole('button', { name: 'Save report', exact: true }).click();
	const download = await reportDownload;
	const path = await download.path();
	expect(path).not.toBeNull();
	const document = JSON.parse(await readFile(path, 'utf8'));
	await report.locator('.audio-editor-dialog-footer').getByRole('button', { name: 'Close', exact: true }).click();
	await expect(report).toBeHidden();
	return { document, fileName: download.suggestedFilename() };
}

test('a saved delivery report retains the project that produced its export', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await renameProject(page, editor, 'Delivered programme');
	await importFiles(editor, [toneA]);
	const exportDialog = await openExportDialog(page, editor);
	await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
	const audioDownload = page.waitForEvent('download');
	await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
	expect((await audioDownload).suggestedFilename()).toMatch(/\.wav$/u);
	await expect(exportDialog.locator('[data-export-download]')).toBeVisible();
	await exportDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(exportDialog).toBeHidden();
	const original = await saveReport(page, editor);
	expect(original.document.projectTitle).toBe('Delivered programme');
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await renameProject(page, editor, 'Unrelated draft');
	const retained = await saveReport(page, editor);
	expect(retained.document.projectTitle).toBe('Delivered programme');
	expect(retained.fileName).toMatch(/^Delivered-programme-delivery-report-/u);
});
