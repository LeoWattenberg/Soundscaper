/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	chooseFileAction,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	disableNativeSavePicker,
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

	test('saves and restores the global recording offset from Audio settings', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const openRecordingOffset = async () => {
			await chooseCommandAction(page, editor, 'Edit', 'Preferences');
			const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
			await preferences.getByRole('tab', { name: /Audio settings$/u }).click();
			await expect(preferences.getByText('Recording offset', { exact: true })).toBeVisible();
			return preferences;
		};

		let preferences = await openRecordingOffset();
		await expect(preferences.getByRole('combobox', { name: 'Recording source', exact: true }))
			.toHaveValue('global');
		const offset = preferences.getByRole('spinbutton', { name: 'Recording offset (ms)', exact: true });
		await offset.fill('137.25');
		await offset.blur();
		await expect.poll(() => offset.evaluate((element) => element.checkValidity())).toBe(true);
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(preferences).toBeHidden();

		preferences = await openRecordingOffset();
		await expect(preferences.getByRole('spinbutton', { name: 'Recording offset (ms)', exact: true })).toHaveValue('137.25');
		await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
		await expect(preferences).toBeHidden();
		expect(errors).toEqual([]);
	});

	test('opens the track dialogs from the Tracks menu and assignable Audacity commands', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const track = clipByName(editor, toneA.name).locator('xpath=ancestor::*[@data-track-row][1]');
		await track.locator('[data-track-header]').click();
		await expect(track.locator('[data-track-lane]')).toHaveAttribute('data-selected', 'true');

		await chooseCommandAction(page, editor, 'Tracks', 'Resample');
		let rateDialog = page.getByRole('dialog', { name: 'Resample', exact: true });
		await rateDialog.locator('input').fill('44100');
		await rateDialog.getByRole('button', { name: 'Resample', exact: true }).click();
		await expect(rateDialog).toBeHidden({ timeout: 10_000 });

		await chooseCommandAction(page, editor, 'Edit', 'Preferences');
		const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
		await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
		const search = preferences.getByRole('searchbox', { name: 'Search commands', exact: true });
		await search.fill('Rename track');
		const renameRow = preferences.locator('[data-shortcut-action="track-rename"]');
		await renameRow.locator('[data-shortcut-binding="0"]').fill('Ctrl+Alt+Shift+R');
		await renameRow.getByRole('button', { name: 'Assign', exact: true }).click();
		await search.fill('Custom track sample rate');
		const rateRow = preferences.locator('[data-shortcut-action="track-change-rate-custom"]');
		await rateRow.locator('[data-shortcut-binding="0"]').fill('Ctrl+Alt+Shift+G');
		await rateRow.getByRole('button', { name: 'Assign', exact: true }).click();
		await preferences.locator('.audio-editor-dialog-footer')
			.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(preferences).toBeHidden();

		await editor.locator('.kw-audio-editor__keyboard-help').focus();
		await page.keyboard.press('Control+Alt+Shift+r');
		const rename = page.getByRole('dialog', { name: 'Track name', exact: true });
		await rename.getByRole('textbox', { name: 'Track name', exact: true }).fill('Dialog command track');
		await rename.getByRole('textbox', { name: 'Track name', exact: true }).press('Enter');
		await expect(rename).toBeHidden();
		await expect(editor.getByRole('button', {
			name: 'Rename track: Dialog command track', exact: true,
		})).toBeVisible();

		await editor.locator('.kw-audio-editor__keyboard-help').focus();
		await page.keyboard.press('Control+Alt+Shift+g');
		rateDialog = page.getByRole('dialog', { name: 'Sample rate', exact: true });
		const customRate = rateDialog.locator('input');
		await expect(customRate).toHaveValue('44100');
		await customRate.fill('32000');
		await rateDialog.getByRole('button', { name: 'Save', exact: true }).click();
		await expect(rateDialog).toBeHidden({ timeout: 10_000 });
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
