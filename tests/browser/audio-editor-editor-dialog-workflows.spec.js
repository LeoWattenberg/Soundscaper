/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	chooseFileAction,
	chooseNestedCommandAction,
	collectClientErrors,
	disableNativeSavePicker,
	getMenuItem,
	importFiles,
	openExportDialog,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('shared editor dialog workflows', () => {
	registerAudioEditorHooks();

	test('submits project names by keyboard, closes About, and clears local data by confirmation', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const originalProjectId = await editor.getAttribute('data-project-id');

		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
		const rename = page.getByRole('dialog', { name: 'Rename project', exact: true });
		const name = rename.locator('[data-project-name-input] input');
		await name.fill('   ');
		await name.press('Enter');
		await expect(rename).toBeVisible();
		await expect(rename.getByRole('button', { name: 'Save name', exact: true })).toBeDisabled();
		await name.fill('Dialog workflow project');
		await name.press('Enter');
		await expect(rename).toBeHidden();
		await expect(editor.locator('[data-project-name]')).toHaveText('Dialog workflow project');

		await chooseCommandAction(page, editor, 'Help', 'About Soundscaper');
		const about = page.getByRole('dialog', { name: 'About Soundscaper', exact: true });
		await expect(about).toContainText('Soundscaper');
		await about.locator('.audio-editor-dialog-footer')
			.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(about).toBeHidden();

		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Clear all local editor data']);
		let clear = page.getByRole('dialog', { name: 'Clear all local editor data', exact: true });
		await clear.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(clear).toBeHidden();
		await expect(editor).toHaveAttribute('data-project-id', originalProjectId);

		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Clear all local editor data']);
		clear = page.getByRole('dialog', { name: 'Clear all local editor data', exact: true });
		await clear.getByRole('button', { name: 'Clear all local editor data', exact: true }).click();
		await expect(clear).toBeHidden();
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(originalProjectId);
		expect(errors).toEqual([]);
	});

	test('saves and restores the global recording offset from Record options', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const openRecordingOffset = async () => {
			await editor.getByRole('button', { name: 'Record options', exact: true }).click();
			await getMenuItem(
				page.getByRole('menu', { name: 'Record options', exact: true }),
				'Recording offset',
			).click();
			const dialog = page.getByRole('dialog', { name: 'Recording offset', exact: true });
			await expect(dialog).toBeVisible();
			return dialog;
		};

		let dialog = await openRecordingOffset();
		await expect(dialog.getByRole('combobox', { name: 'Recording source', exact: true }))
			.toHaveValue('global');
		const directEntry = dialog.locator('[data-timecode-direct-entry="true"]');
		await directEntry.fill('137');
		await dialog.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(dialog).toBeHidden();

		dialog = await openRecordingOffset();
		await expect(dialog.locator('[data-timecode-direct-entry="true"]')).toHaveValue('137');
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toBeHidden();
		expect(errors).toEqual([]);
	});

	test('saves the report produced by an ordinary WAV export', async ({ page }) => {
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);

		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		const exportDownload = page.waitForEvent('download');
		await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();
		expect((await exportDownload).suggestedFilename()).toMatch(/\.wav$/u);
		await expect(exportDialog.locator('[data-export-download]')).toBeVisible({ timeout: 20_000 });
		await exportDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(exportDialog).toBeHidden();

		await chooseFileAction(page, editor, 'Delivery Report');
		const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
		await expect(report.locator('[data-delivery-report]')).toContainText(/wav/iu);
		const reportDownload = page.waitForEvent('download');
		await report.getByRole('button', { name: 'Save report', exact: true }).click();
		expect((await reportDownload).suggestedFilename()).toMatch(/-delivery-report-\d{4}-\d{2}-\d{2}\.json$/u);
		await expect(report).toBeVisible();
		await report.locator('.audio-editor-dialog-footer')
			.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(report).toBeHidden();
		expect(errors).toEqual([]);
	});
});
