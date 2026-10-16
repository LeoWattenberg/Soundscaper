/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, clipByName, closeDialog,
	closeWorkspacePanel, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';
import { chooseTrackMenuAction } from './helpers/track-menu.js';

test('a normal channel split keeps the surviving track ADM assignment', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const track = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row]');
	const trackId = await track.getAttribute('data-track-id');
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	await metadata.locator('select[name="adm-bed-layout"]').selectOption('mono');
	await metadata.getByRole('combobox', { name: /browser-tone-a.*channel 2/u }).selectOption('');
	await closeWorkspacePanel(editor, 'metadata');
	const exportBw64 = async () => {
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'BW64 / ADM');
		const link = dialog.locator('[data-export-download]');
		const previous = await link.count() ? await link.getAttribute('href') : null;
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		await expect(link).toBeVisible({ timeout: 20_000 });
		await expect.poll(() => link.getAttribute('href')).not.toBe(previous);
		expect(new TextDecoder().decode((await readDownloadBytes(page, link)).subarray(0, 4))).toBe('BW64');
		await closeDialog(dialog);
	};
	await exportBw64();
	await chooseTrackMenuAction(page, editor, track, ['Track channels', 'Split stereo to left/right mono']);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.locator(`[data-track-row][data-track-id="${trackId}"]`)).toBeVisible();
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await expect(metadata.getByRole('combobox', { name: /browser-tone-a.*Left.*channel 1/u })).toHaveValue('M');
	await metadata.getByRole('combobox', { name: /browser-tone-a.*Right.*channel 1/u }).selectOption('M');
	await closeWorkspacePanel(editor, 'metadata');
	await exportBw64();
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await exportBw64();
});
