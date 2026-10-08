/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import { expect, test } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, disableNativeSavePicker, importFiles, openExportDialog, readDownloadBytes,
} from './audio-editor-test-helpers.js';

// Unchanged BWF MetaEdit --in-iXML output over an ordinary Python wave recording.
const recording = Buffer.from(readFileSync(new URL('../fixtures/bwfmetaedit-ixml-clock.wav.base64', import.meta.url), 'utf8').trim(), 'base64');

for (const delivery of [
	{ rate: 96_000, bits: 24, slate: 48_000, name: 'a resampled broadcast delivery keeps the recorder slate at its audible half-second position' },
	{ rate: 48_000, bits: 16, slate: 24_000, name: 'an unchanged broadcast delivery preserves the original recorder XML' },
]) test(delivery.name, async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [{ name: 'production-take.wav', mimeType: 'audio/wav', buffer: recording }]);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'Broadcast WAV (BWF)');
	await dialog.locator('[data-export-field="sampleRate"] input').fill(String(delivery.rate));
	await dialog.locator('[data-export-field="sampleRate"] input').press('Tab');
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), `${delivery.bits}-bit PCM`);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const link = dialog.locator('[data-export-download]');
	await expect(link).toBeVisible({ timeout: 20_000 });
	const bytes = await readDownloadBytes(page, link);
	const chunks = riffChunks(bytes);
	const format = new DataView(chunks.get('fmt ').buffer, chunks.get('fmt ').byteOffset, chunks.get('fmt ').byteLength);
	expect(format.getUint32(4, true)).toBe(delivery.rate);
	const xml = new TextDecoder().decode(chunks.get('iXML'));
	await test.info().attach('delivered-recorder-iXML', { body: xml, contentType: 'application/xml' });
	expect(xml).toContain('<NOTE>Clean boom take</NOTE>');
	expect(xml).toContain(`<SYNC_POINT_LOW>${delivery.slate}</SYNC_POINT_LOW>`);
	expect(xml).toContain(`<FILE_SAMPLE_RATE>${delivery.rate}</FILE_SAMPLE_RATE>`);
	expect(xml).toContain(`<AUDIO_BIT_DEPTH>${delivery.bits}</AUDIO_BIT_DEPTH>`);
	expect(xml).toContain('<DIGITIZER_SAMPLE_RATE>48000</DIGITIZER_SAMPLE_RATE>');
	if (delivery.rate === 48_000) expect(xml).toBe(new TextDecoder().decode(riffChunks(recording).get('iXML')));
});

function riffChunks(bytes) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const chunks = new Map();
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const size = view.getUint32(offset + 4, true);
		chunks.set(new TextDecoder().decode(bytes.subarray(offset, offset + 4)), bytes.subarray(offset + 8, offset + 8 + size));
		offset += 8 + size + (size % 2);
	}
	return chunks;
}
