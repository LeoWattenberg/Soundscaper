/* SPDX-License-Identifier: AGPL-3.0-only */

import { encodeWav } from '../../src/common/editor/wav.js';
import { parseAiffMarkChunk } from '../../src/common/editor/aiff-markers.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseDropdown, chooseNestedCommandAction,
	closeDialog, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

test('AIFF delivery reports a normal marker name shortened to its Pascal-string limit', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'programme.wav', mimeType: 'audio/wav', buffer: Buffer.from(encodeWav([
		Float32Array.from({ length: 24_000 }, (_, index) => 0.2 * Math.sin(index * Math.PI * 880 / 48_000)),
	], { sampleRate: 48_000, bitDepth: 16, markers: [{ sampleOffset: 0, label: 'Opening' }] })) }]);
	await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
	const markers = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
	await markers.locator('[data-timeline-annotation]').press('Enter');
	const fullName = `${'Opening chapter '.repeat(18)}Résumé`;
	const name = markers.getByRole('textbox', { name: 'Name', exact: true });
	await name.fill(fullName);
	await name.press('Enter');
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'AIFF');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = dialog.locator('[data-export-download]');
	await expect(download).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, download);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let deliveredMarkers = [];
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = view.getUint32(offset + 4, false);
		if (new TextDecoder().decode(bytes.subarray(offset, offset + 4)) === 'MARK') {
			deliveredMarkers = parseAiffMarkChunk(bytes.subarray(offset + 8, offset + 8 + size));
		}
		offset += 8 + size + (size % 2);
	}
	expect(deliveredMarkers).toHaveLength(1);
	expect(deliveredMarkers[0].label).toBe(fullName.slice(0, 255));
	await closeDialog(dialog);
	await markers.locator('[data-timeline-annotation]').press('Enter');
	await expect(markers.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(fullName);
	await markers.getByRole('textbox', { name: 'Name', exact: true }).press('Escape');
	await chooseCommandAction(page, editor, 'File', 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report.locator('[data-severity="warning"]').filter({ hasText: /marker.*name.*(?:shorten|truncat)/iu })).toHaveCount(1);
});
