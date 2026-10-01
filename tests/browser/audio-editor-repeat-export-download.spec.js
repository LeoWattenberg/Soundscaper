/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	expect,
	test,
	toneA,
	toneB,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	closeDialog,
	collectClientErrors,
	chooseDropdown,
	disableNativeSavePicker,
	downloadBytes,
	importFiles,
	openExportDialog,
	waitForProjectActivation,
} from './audio-editor-test-helpers.js';

test('keeps repeated and changed exports bound to their project tabs', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const errors = collectClientErrors(page);
	const downloads = [];
	page.on('download', (download) => downloads.push(download));
	const editor = await bootEditor(page, '/embed/en/');
	const firstProjectId = await editor.getAttribute('data-project-id');
	expect(firstProjectId).not.toBeNull();
	await importFiles(editor, [toneA]);

	const exportOnce = async (format) => {
		const expectedDownloads = downloads.length + 1;
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), format);
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		await expect.poll(() => downloads.length, { timeout: 20_000 }).toBe(expectedDownloads);
		const download = downloads.at(-1);
		const bytes = await downloadBytes(download);
		await closeDialog(dialog);
		return {
			filename: download.suggestedFilename(),
			signature: new TextDecoder('latin1').decode(bytes.subarray(0, 4)),
		};
	};

	const first = await exportOnce('WAV');
	expect(first.filename).toMatch(/\.wav$/u);
	expect(first.signature).toBe('RIFF');

	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await expect.poll(() => editor.getAttribute('data-project-id')).not.toBe(firstProjectId);
	await waitForProjectActivation(editor);
	const secondProjectId = await editor.getAttribute('data-project-id');
	await importFiles(editor, [toneB]);
	const second = await exportOnce('AIFF');
	expect(second.filename).toMatch(/\.aiff$/u);
	expect(second.signature).toBe('FORM');

	const firstTab = editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab').nth(0);
	await firstTab.click();
	await expect(editor).toHaveAttribute('data-project-id', firstProjectId);
	await waitForProjectActivation(editor);
	const repeated = await exportOnce('WAV');
	expect(repeated.filename).toBe(first.filename);
	expect(repeated.signature).toBe('RIFF');
	expect(await editor.getAttribute('data-project-id')).not.toBe(secondProjectId);
	expect(errors).toEqual([]);
});
