/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseDropdown, chooseFileAction, closeWorkspacePanel,
	disableNativeSavePicker, downloadBytes, importFiles, openExportDialog,
} from './audio-editor-test-helpers.js';

async function saveWavPreset(page, dialog, name) {
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const prompt = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await prompt.getByRole('textbox', { name: 'Preset name', exact: true }).fill(name);
	await prompt.getByRole('button', { name: 'Save preset', exact: true }).click();
	await expect(prompt).toBeHidden();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
}

test('a buffered BW64 delivery queue job downloads the file it marks delivered', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	await closeWorkspacePanel(editor, 'metadata');
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'BW64 / ADM');
	await saveWavPreset(page, dialog, 'ADM programme');
	await chooseFileAction(page, editor, 'Delivery queue');
	const queue = page.getByRole('dialog', { name: 'Delivery queue', exact: true });
	await queue.getByRole('checkbox', { name: 'ADM programme', exact: true }).check();
	const downloads = [];
	page.on('download', (download) => downloads.push(download));
	await queue.getByRole('button', { name: 'Queue batch', exact: true }).click();
	await expect(queue.getByRole('listitem').filter({ hasText: 'project — ADM programme' }))
		.toContainText('Delivered', { timeout: 30_000 });
	await expect.poll(() => downloads.length, { timeout: 10_000 }).toBe(1);
	const bytes = await downloadBytes(downloads[0]);
	expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('BW64');
});

test('a stems delivery batch drops the normalization hidden by its mode', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Loudness normalization', exact: true }), 'Streaming (-14 LUFS)');
	await saveWavPreset(page, dialog, 'Streaming master');
	await chooseFileAction(page, editor, 'Delivery queue');
	const queue = page.getByRole('dialog', { name: 'Delivery queue', exact: true });
	await chooseDropdown(page, queue.getByRole('group', { name: 'Output', exact: true }), 'Individual stems (archive)');
	await queue.getByRole('checkbox', { name: 'Streaming master', exact: true }).check();
	await queue.getByRole('button', { name: 'Queue batch', exact: true }).click();
	await expect(queue.getByRole('listitem').filter({ hasText: 'project — Streaming master' }))
		.toContainText('Delivered', { timeout: 30_000 });
});
