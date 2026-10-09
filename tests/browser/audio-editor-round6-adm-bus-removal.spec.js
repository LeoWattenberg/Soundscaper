/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction,
	closeWorkspacePanel, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

for (const remove of [false, true]) test(`authored ADM exports ${remove ? 'after ordinary group removal and explicit reassignment' : 'through its ordinary group bus'}`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA, toneB]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const mixer = editor.locator('[data-mixer-panel]');
	await mixer.getByRole('button', { name: 'Add group bus', exact: true }).click();
	const output = mixer.getByRole('combobox', { name: /Output:.*browser-tone-a/u });
	await output.selectOption({ label: 'Group bus 1' });
	const groupId = await output.inputValue();
	await closeWorkspacePanel(editor, 'mixer');
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	await closeWorkspacePanel(editor, 'metadata');
	if (remove) {
		await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
		await mixer.getByRole('combobox', { name: 'Remove bus', exact: true }).selectOption(`group:${groupId}`);
		await closeWorkspacePanel(editor, 'mixer');
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
		await metadata.getByRole('combobox', { name: /browser-tone-a.*channel 1/u }).selectOption('L');
		await metadata.getByRole('combobox', { name: /browser-tone-a.*channel 2/u }).selectOption('R');
		await closeWorkspacePanel(editor, 'metadata');
	}
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'BW64 / ADM');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = dialog.locator('[data-export-download]');
	await expect(download).toBeVisible({ timeout: 15_000 });
	expect(new TextDecoder().decode((await readDownloadBytes(page, download)).subarray(0, 4))).toBe('BW64');
});
