import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	commitInput,
	importFiles,
	openExportDialog,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('BW64 ADM metadata UI', () => {
	registerAudioEditorHooks();

	test('authors a DirectSpeakers bed and carries its draft into BW64 export', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		let panel = editor.locator('[data-workspace-panel="metadata"]');
		await panel.getByRole('tab', { name: 'ADM', exact: true }).click();
		await panel.getByRole('button', { name: 'Enable ADM', exact: true }).click();
		await panel.locator('select[name="adm-bed-layout"]').selectOption('mono');
		await commitInput(panel.locator('input[name="adm-programme-name"]'), 'Evening programme');
		await expect(panel.locator('[data-adm-mode="authored"]')).toBeVisible();
		await expect(panel.locator('.audio-editor-adm-route select')).toHaveCount(2);
		for (const route of await panel.locator('.audio-editor-adm-route select').all()) await expect(route).toHaveValue('M');

		await panel.getByRole('button', { name: 'Close: Metadata', exact: true }).click();
		await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
		panel = editor.locator('[data-workspace-panel="metadata"]');
		await panel.getByRole('tab', { name: 'ADM', exact: true }).click();
		await expect(panel.locator('input[name="adm-programme-name"]')).toHaveValue('Evening programme');
		await panel.getByRole('button', { name: 'Close: Metadata', exact: true }).click();

		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'BW64 / ADM');
		await expect(dialog.locator('[data-export-field="mode"] button')).toBeDisabled();
		await expect(dialog.locator('[data-export-field="channelMapping"] button')).toBeDisabled();
		await dialog.getByRole('button', { name: 'Metadata', exact: true }).click();
		const metadataDialog = page.getByRole('dialog', { name: 'Metadata', exact: true });
		await expect(metadataDialog.getByRole('tab')).toHaveCount(3);
		await metadataDialog.getByRole('tab', { name: 'ADM', exact: true }).click();
		await expect(metadataDialog.locator('input[name="adm-programme-name"]')).toHaveValue('Evening programme');
		await expect(metadataDialog.locator('select[name="adm-bed-layout"]')).toHaveValue('mono');
	});
});
