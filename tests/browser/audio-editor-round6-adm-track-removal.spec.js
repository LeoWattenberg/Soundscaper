/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseDropdown, clipByName, closeDialog, closeWorkspacePanel,
	disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

for (const remove of [false, true]) test(`authored ADM exports ${remove ? 'after removing one recording' : 'both ordinary recordings'}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	await closeWorkspacePanel(editor, 'metadata');
	if (remove) {
		await chooseCommandAction(page, editor, 'Select', 'Select none');
		const recording = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row]');
		await recording.locator('.track-control-panel__track-name-text').click();
		await chooseCommandAction(page, editor, 'Tracks', 'Remove tracks');
		await expect(clipByName(editor, toneA.name)).toHaveCount(0);
		await expect(clipByName(editor, toneB.name)).toBeVisible();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
	}
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'BW64 / ADM');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(dialog.locator('[data-export-download]')).toBeVisible({ timeout: 20_000 });
	expect(new TextDecoder().decode((await readDownloadBytes(page, dialog.locator('[data-export-download]'))).subarray(0, 4))).toBe('BW64');
	if (remove) {
		await closeDialog(dialog);
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(clipByName(editor, toneA.name)).toBeVisible();
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(clipByName(editor, toneB.name)).toBeVisible();
	}
});
