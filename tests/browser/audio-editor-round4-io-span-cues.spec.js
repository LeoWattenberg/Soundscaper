/* SPDX-License-Identifier: AGPL-3.0-only */

import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { parseRiffMarkers } from '../../src/common/editor/riff-markers.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, closeDialog, disableNativeSavePicker,
	importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

function markers(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let cue = null;
	const adtl = [];
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const id = new TextDecoder().decode(bytes.subarray(offset, offset + 4));
		const size = view.getUint32(offset + 4, true);
		const payload = bytes.subarray(offset + 8, offset + 8 + size);
		if (id === 'cue ') cue = payload;
		if (id === 'LIST' && new TextDecoder().decode(payload.subarray(0, 4)) === 'adtl') adtl.push(payload.subarray(4));
		offset += 8 + size + (size % 2);
	}
	return parseRiffMarkers(cue, adtl).map(({ sampleOffset, label }) => ({ sampleOffset, label }));
}

test('chapter WAV files retain their ordinary source cue metadata', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'marked-programme.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([
		Float32Array.from({ length: 48_000 }, (_, index) => 0.2 * Math.sin(index * Math.PI * 880 / 48_000)),
	], { sampleRate: 48_000, bitDepth: 16, markers: [{ sampleOffset: 0, label: 'Opening cue' }] })) }]);
	let dialog = await openExportDialog(page, editor);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	let download = dialog.locator('[data-export-download]');
	await expect(download).toBeVisible({ timeout: 20_000 });
	expect(markers(await readDownloadBytes(page, download))).toEqual([{ sampleOffset: 0, label: 'Opening cue' }]);
	await closeDialog(dialog);
	dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), 'Chapters (split by markers)');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	download = dialog.locator('[data-export-download]');
	await expect(download).toBeVisible({ timeout: 20_000 });
	await expect(download).toHaveAttribute('download', /\.zip$/u);
	const archive = new ZipReader(new Uint8ArrayReader(await readDownloadBytes(page, download)), { useWebWorkers: false });
	try {
		const entries = await archive.getEntries();
		expect(entries).toHaveLength(1);
		const bytes = await entries[0].getData(new Uint8ArrayWriter());
		expect(markers(bytes)).toEqual([{ sampleOffset: 0, label: 'Opening cue' }]);
	} finally { await archive.close(); }
});
