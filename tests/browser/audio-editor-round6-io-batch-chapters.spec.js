/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { unzipSync } from 'fflate';
import {
	bootEditor, chooseCommandAction, chooseDropdown, chooseFileAction, disableNativeSavePicker,
	downloadBytes, importFiles, openExportDialog, registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

test.describe('chapter preset delivery applicability', () => {
	registerAudioEditorHooks();

	test('a saved MP3 chapter preset delivers its ordinary stems batch', async ({ page }) => {
		test.setTimeout(90_000);
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		await chooseCommandAction(page, editor, 'Edit', 'Add label');
		const title = editor.getByRole('textbox', { name: /^Edit labels:/u });
		await title.fill('Opening chapter');
		await title.press('Enter');
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'MP3');
		await dialog.getByRole('checkbox', { name: 'Embed labels as chapters', exact: true }).check();
		await dialog.getByRole('button', { name: 'Save preset', exact: true }).click();
		await page.getByRole('menuitem', { name: 'Save as new preset', exact: true }).click();
		const prompt = page.getByRole('dialog', { name: 'Save as new preset', exact: true });
		await prompt.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Podcast chapters');
		await prompt.getByRole('button', { name: 'Save preset', exact: true }).click();
		await expect(prompt).toBeHidden();
		await expect(dialog.getByRole('button', { name: 'Preset', exact: true })).toContainText('Podcast chapters');
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await chooseFileAction(page, editor, 'Delivery queue');
		const queue = page.getByRole('dialog', { name: 'Delivery queue', exact: true });
		await chooseDropdown(page, queue.getByRole('group', { name: 'Output', exact: true }), 'Individual stems (archive)');
		await queue.getByRole('checkbox', { name: 'Podcast chapters', exact: true }).check();
		const downloads = [];
		page.on('download', download => downloads.push(download));
		await queue.getByRole('button', { name: 'Queue batch', exact: true }).click();
		const row = queue.getByRole('listitem').filter({ hasText: 'project — Podcast chapters' });
		await expect(row).toContainText('Delivered', { timeout: 30_000 });
		await expect.poll(() => downloads.length).toBe(1);
		const files = Object.entries(unzipSync(await downloadBytes(downloads[0])));
		expect(files).toHaveLength(1);
		expect(files[0][0]).toMatch(/\.mp3$/u);
		expect(files[0][1].byteLength).toBeGreaterThan(1_000);
		expect(new TextDecoder().decode(files[0][1].slice(0, 3))).toBe('ID3');
	});
});
