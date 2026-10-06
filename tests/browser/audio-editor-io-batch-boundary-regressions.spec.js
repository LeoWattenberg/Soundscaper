/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseDropdown, chooseFileAction, chooseNestedCommandAction, closeWorkspacePanel,
	disableNativeSavePicker, importFiles, openExportDialog,
} from './audio-editor-test-helpers.js';

async function savePreset(page, dialog, name) {
	await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
	const prompt = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
	await prompt.getByRole('textbox', { name: 'Preset name', exact: true }).fill(name);
	await prompt.getByRole('button', { name: 'Save preset', exact: true }).click();
	await expect(prompt).toBeHidden();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
}

async function openQueue(page, editor) {
	await chooseFileAction(page, editor, 'Delivery queue');
	return page.getByRole('dialog', { name: 'Delivery queue', exact: true });
}

test('a mixed-programme BW64 preset is unavailable for a stems batch', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Edit', 'Metadata editor');
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'ADM', exact: true }).click();
	await metadata.getByRole('button', { name: 'Enable ADM', exact: true }).click();
	await closeWorkspacePanel(editor, 'metadata');
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'BW64 / ADM');
	await savePreset(page, dialog, 'ADM programme');
	const queue = await openQueue(page, editor);
	const preset = queue.getByRole('checkbox', { name: 'ADM programme', exact: true });
	await preset.check();
	await chooseDropdown(page, queue.getByRole('group', { name: 'Output', exact: true }), 'Individual stems (archive)');
	await expect(preset).toBeDisabled();
	await expect(preset).not.toBeChecked();
	await expect(queue.getByRole('button', { name: 'Queue batch', exact: true })).toBeDisabled();
	await chooseDropdown(page, queue.getByRole('group', { name: 'Output', exact: true }), 'Stereo mix');
	await expect(preset).toBeEnabled();
	await expect(preset).toBeChecked();
});

test('a paused delivery cannot export a different project after switching tabs', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const naming = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await naming.locator('[data-project-name-input] input').fill('Original recording');
	await naming.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(naming).toBeHidden();
	await savePreset(page, await openExportDialog(page, editor), 'WAV master');
	let queue = await openQueue(page, editor);
	await queue.getByRole('button', { name: 'Pause between jobs', exact: true }).click();
	await queue.getByRole('checkbox', { name: 'WAV master', exact: true }).check();
	await queue.getByRole('button', { name: 'Queue batch', exact: true }).click();
	await expect(queue.getByRole('listitem').filter({ hasText: 'project — WAV master' })).toContainText('Queued');
	await queue.getByRole('button', { name: 'Close', exact: true }).last().click();
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await importFiles(editor, [toneB]);
	queue = await openQueue(page, editor);
	const downloads = [];
	page.on('download', (download) => downloads.push(download));
	await queue.getByRole('button', { name: 'Resume', exact: true }).click();
	await expect(queue.getByRole('listitem').filter({ hasText: 'project — WAV master' })).toContainText('Failed');
	expect(downloads).toHaveLength(0);
	await expect(queue).toContainText('Reopen the original project');
	await queue.getByRole('button', { name: 'Close', exact: true }).last().click();
	await editor.getByRole('tab', { name: 'Original recording', exact: true }).click();
	queue = await openQueue(page, editor);
	await queue.getByRole('button', { name: 'Retry', exact: true }).click();
	await expect(queue.getByRole('listitem').filter({ hasText: 'project — WAV master' })).toContainText('Delivered');
	await expect.poll(() => downloads.length).toBe(1);
});
