/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, monoTone } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction,
	closeDialog, closeWorkspacePanel, disableNativeSavePicker, importFiles,
	openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

test('an unchanged duplicate of a pristine ADM project remains exportable', async ({ page }) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Editing$/u }).click();
	await preferences.getByRole('checkbox', { name: 'Apply 2 ms fades to new clips' }).uncheck();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	await expect(preferences).toBeHidden();
	await importFiles(editor, [monoTone]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	await closeWorkspacePanel(editor, 'metadata');
	let dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'BW64 / ADM');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = dialog.locator('[data-export-download]');
	await expect(download).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, download);
	await closeDialog(dialog);
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '0');
	await importFiles(editor, [{ name: 'pristine-programme.wav', mimeType: 'audio/wav', buffer: Buffer.from(bytes) }]);
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'BW64 / ADM');
	await clearAdditionalTitle(page, dialog);
	await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(dialog.locator('[data-export-download]')).toBeVisible({ timeout: 20_000 });
	const pristineBytes = await readDownloadBytes(page, dialog.locator('[data-export-download]'));
	expect(new TextDecoder().decode(pristineBytes.subarray(0, 4))).toBe('BW64');
	await closeDialog(dialog);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Duplicate project']);
	await expect(editor.locator('[data-project-name]')).toContainText('copy');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'BW64 / ADM');
	await clearAdditionalTitle(page, dialog);
	await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(dialog.locator('[data-export-download]')).toBeVisible({ timeout: 20_000 });
	const copiedBytes = await readDownloadBytes(page, dialog.locator('[data-export-download]'));
	expect(copiedBytes).toEqual(pristineBytes);
});

async function clearAdditionalTitle(page, dialog) {
	await dialog.getByRole('button', { name: 'Metadata', exact: true }).click();
	const metadata = page.getByRole('dialog', { name: 'Metadata', exact: true });
	await metadata.getByRole('tab', { name: 'General', exact: true }).click();
	await metadata.locator('[data-export-metadata-tab="general"]')
		.getByRole('textbox', { name: 'Title', exact: true }).fill('');
	await metadata.getByRole('button', { name: /^Done\.?$/u }).click();
}
