/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

// The unchanged BWF MetaEdit production fixture carries a recorder description
// and half-second iXML slate; both conventional suffixes describe those bytes.
const recording = Buffer.from(readFileSync(new URL('../fixtures/bwfmetaedit-ixml-clock.wav.base64', import.meta.url), 'utf8').trim(), 'base64');

for (const extension of ['wav', 'bwf']) {
	test(`File Import preserves recorder BEXT and iXML from an ordinary ${extension.toUpperCase()} delivery`, async ({ page }) => {
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [{ name: `production-take.${extension}`, mimeType: 'application/octet-stream', buffer: recording }]);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const dialog = await openExportDialog(page, editor);
		await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
		await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '16-bit PCM');
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		const link = dialog.locator('[data-export-download]');
		await expect(link).toBeVisible({ timeout: 20_000 });
		const delivered = chunks(await readDownloadBytes(page, link));
		const format = delivered.get('fmt ');
		expect(new DataView(format.buffer, format.byteOffset, format.byteLength).getUint32(4, true)).toBe(48_000);
		expect(delivered.has('iXML')).toBe(true);
		expect(new TextDecoder().decode(delivered.get('iXML'))).toBe(new TextDecoder().decode(chunks(recording).get('iXML')));
		expect(new TextDecoder().decode(delivered.get('bext').subarray(0, 256))).toContain('Production boom take');
	});
}

function chunks(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const result = new Map();
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = view.getUint32(offset + 4, true);
		result.set(new TextDecoder().decode(bytes.subarray(offset, offset + 4)), bytes.subarray(offset + 8, offset + 8 + size));
		offset += 8 + size + (size % 2);
	}
	return result;
}
