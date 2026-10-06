/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseFileAction, disableNativeSavePicker, openExportDialog, readDownloadBytes } from './audio-editor-test-helpers.js';

for (const extension of ['aif', 'aifc']) {
	test(`an ordinary uncompressed AIFF-C ${extension} recording imports and delivers its tone`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		// Python 3.12 aifc.open('tone.aif', 'wb'), mono 16-bit 8 kHz, one second
		// of 440 Hz at 0.25 amplitude. The documented default is AIFF-C NONE.
		const encoded = await readFile(new URL('../fixtures/python-uncompressed.aif.base64', import.meta.url), 'ascii');
		const picking = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Import');
		await (await picking).setFiles({ name: `ordinary-tone.${extension}`, mimeType: 'audio/x-aiff', buffer: Buffer.from(encoded, 'base64') });
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
		const rate = dialog.locator('[data-export-field="sampleRate"] input');
		await rate.fill('8000');
		await rate.press('Tab');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const download = dialog.locator('[data-export-download]');
		await expect(download).toBeVisible();
		const bytes = Buffer.from(await readDownloadBytes(page, download));
		let data;
		let sampleRate;
		for (let offset = 12; offset + 8 <= bytes.length;) {
			const id = bytes.toString('ascii', offset, offset + 4);
			const size = bytes.readUInt32LE(offset + 4);
			if (id === 'fmt ') sampleRate = bytes.readUInt32LE(offset + 12);
			if (id === 'data') data = bytes.subarray(offset + 8, offset + 8 + size);
			offset += 8 + size + size % 2;
		}
		expect(sampleRate).toBe(8000);
		expect(data).toBeDefined();
		// The default stereo 24-bit export keeps duration and the audible tone.
		expect(data.length).toBe(8000 * 2 * 3);
		let peak = 0;
		for (let offset = 0; offset < data.length; offset += 6) peak = Math.max(peak, Math.abs(data.readIntLE(offset, 3) / 8388608));
		expect(peak).toBeGreaterThan(0.17);
		expect(peak).toBeLessThan(0.26);
	});
}
