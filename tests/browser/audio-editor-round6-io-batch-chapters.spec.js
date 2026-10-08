/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, monoTone, test } from './audio-editor-test-fixtures.js';
import { unzipSync } from 'fflate';
import { persistedProject } from './helpers/complex-editing-workflows.js';
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
		const project = await persistedProject(page, await editor.getAttribute('data-project-id'));
		const stemCount = project.tracks.filter(track => track.type === 'audio').length;
		const downloads = [];
		page.on('download', download => downloads.push(download));
		await queue.getByRole('button', { name: 'Queue batch', exact: true }).click();
		const row = queue.getByRole('listitem').filter({ hasText: 'project — Podcast chapters' });
		await expect(row).toContainText('Delivered', { timeout: 30_000 });
		await expect.poll(() => downloads.length).toBe(1);
		const files = Object.entries(unzipSync(await downloadBytes(downloads[0])));
		expect(files).toHaveLength(stemCount);
		for (const [name, bytes] of files) {
			expect(name).toMatch(/\.mp3$/u);
			expect(bytes.byteLength).toBeGreaterThan(1_000);
		}
		const decoded = await page.evaluate(async members => {
			const context = new OfflineAudioContext(1, 1, 48_000);
			return await Promise.all(members.map(async bytes => {
				const buffer = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
				let peak = 0;
				for (const value of buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(value));
				return { duration: buffer.duration, peak };
			}));
		}, files.map(([, bytes]) => Array.from(bytes)));
		expect(decoded.every(stem => stem.duration > 0.5)).toBe(true);
		expect(decoded.some(stem => stem.peak > 0.1)).toBe(true);
	});
});
