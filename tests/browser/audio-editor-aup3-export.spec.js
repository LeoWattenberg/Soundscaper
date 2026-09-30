/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	expect,
	monoTone,
	test,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseFileAction,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	disableNativeSavePicker,
	downloadBytes,
	importFiles,
	trackNameText,
} from './audio-editor-test-helpers.js';

test('exports an AUP3 through the File menu and reopens its audio', async ({ page }) => {
	test.setTimeout(90_000);
	await disableNativeSavePicker(page);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [monoTone]);
	await expect(clipByName(editor, monoTone.name)).toHaveCount(1);

	const originalTrackCount = await editor.getAttribute('data-track-count');
	const originalClipCount = await editor.getAttribute('data-clip-count');
	const originalTrackNames = await trackNameText(editor).allTextContents();
	const downloadPromise = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export AUP3']);
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/\.aup3$/iu);
	const bytes = await downloadBytes(download);
	expect(new TextDecoder().decode(bytes.subarray(0, 16))).toBe('SQLite format 3\0');
	expect(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(60)).toBe(0x03070000);

	const chooser = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Open');
	await (await chooser).setFiles({
		name: download.suggestedFilename(),
		mimeType: 'application/x-audacity-project',
		buffer: Buffer.from(bytes),
	});
	await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', {
		timeout: 30_000,
	});
	await expect(editor).toHaveAttribute('data-track-count', originalTrackCount);
	await expect(editor).toHaveAttribute('data-clip-count', originalClipCount);
	await expect(trackNameText(editor)).toHaveText(originalTrackNames);
	await expect(clipByName(editor, monoTone.name.replace(/\.[^.]+$/u, ''))).toHaveCount(1);
	expect(errors).toEqual([]);
});
