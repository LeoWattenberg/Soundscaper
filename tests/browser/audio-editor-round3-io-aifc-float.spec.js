/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseFileAction, disableNativeSavePicker, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

test('an ordinary libsndfile AIFF-C float recording imports and delivers its tone', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	// libsndfile 1.2.2 sf_open(SF_FORMAT_AIFF | SF_FORMAT_FLOAT), sf_write_float:
	// 4,800 mono 48 kHz samples of a 440 Hz sine at amplitude 0.25. Bytes are unchanged.
	const encoded = await readFile(new URL('../fixtures/libsndfile-float32.aifc.base64', import.meta.url), 'ascii');
	const choosing = page.waitForEvent('filechooser');
	await chooseFileAction(page, editor, 'Import');
	await (await choosing).setFiles({ name: 'ordinary-float.aifc', mimeType: 'audio/aiff', buffer: Buffer.from(encoded, 'base64') });
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = dialog.locator('[data-export-download]');
	await expect(download).toBeVisible();
	const bytes = Buffer.from(await readDownloadBytes(page, download));
	let pcm;
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const id = bytes.toString('ascii', offset, offset + 4);
		const size = bytes.readUInt32LE(offset + 4);
		if (id === 'data') pcm = bytes.subarray(offset + 8, offset + 8 + size);
		offset += 8 + size + size % 2;
	}
	expect(pcm).toBeDefined();
	expect(pcm.length).toBe(4_800 * 2 * 3);
	let peak = 0;
	for (let offset = 0; offset < pcm.length; offset += 6) peak = Math.max(peak, Math.abs(pcm.readIntLE(offset, 3) / 8_388_608));
	expect(peak).toBeGreaterThan(0.17);
	expect(peak).toBeLessThan(0.26);
});
