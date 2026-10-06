/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, chooseFileAction,
	disableNativeSavePicker, importFiles, openExportDialog,
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
