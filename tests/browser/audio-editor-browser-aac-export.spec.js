/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	collectClientErrors,
	clipByName,
	disableNativeSavePicker,
	importFiles,
	openExportDialog,
	readDownloadBytes,
	registerAudioEditorHooks,
	sourcePeakChannels,
	waitForEditor,
} from './audio-editor-test-helpers.js';

const EXACT_AAC_CONFIGURATION = Object.freeze({
	codec: 'mp4a.40.2',
	sampleRate: 48_000,
	numberOfChannels: 2,
	bitrate: 192_000,
	aac: Object.freeze({ format: 'aac' }),
});

test.describe('browser-native AAC export', () => {
	registerAudioEditorHooks();

	test('generates a complete M4A file through WebCodecs and reimports its audio', async ({ page }) => {
		test.setTimeout(90_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		const supported = await page.evaluate(async (configuration) => {
			if (typeof AudioEncoder !== 'function' || typeof AudioEncoder.isConfigSupported !== 'function') {
				return false;
			}
			try {
				return (await AudioEncoder.isConfigSupported(configuration)).supported === true;
			} catch {
				return false;
			}
		}, EXACT_AAC_CONFIGURATION);
		test.skip(!supported, 'The browser does not support the exact AAC-LC export tuple.');

		await importFiles(editor, [toneA]);
		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'AAC / M4A');
		await exportDialog.getByRole('button', { name: 'Export', exact: true }).click();

		const download = exportDialog.locator('[data-export-download]');
		const failure = exportDialog.locator('.audio-editor-field-error');
		await expect(download.or(failure)).toBeVisible({ timeout: 60_000 });
		expect(await failure.allTextContents()).toEqual([]);
		await expect(download).toHaveAttribute('download', /\.m4a$/u);
		const bytes = await readDownloadBytes(page, download);
		const witness = ((() => {
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			const boxes = [];
			let valid = true;
			let offset = 0;
			const ascii = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length));
			while (offset < bytes.byteLength) {
				if (bytes.byteLength - offset < 8) { valid = false; break; }
				let size = view.getUint32(offset, false);
				const type = ascii(offset + 4, 4);
				let headerSize = 8;
				if (size === 1) {
					if (bytes.byteLength - offset < 16) { valid = false; break; }
					const extended = view.getBigUint64(offset + 8, false);
					if (extended > BigInt(Number.MAX_SAFE_INTEGER)) { valid = false; break; }
					size = Number(extended);
					headerSize = 16;
				} else if (size === 0) {
					size = bytes.byteLength - offset;
				}
				if (size < headerSize || offset + size > bytes.byteLength) { valid = false; break; }
				boxes.push({ type, size });
				offset += size;
			}
			return {
				boxes,
				brand: ascii(8, 4),
				length: bytes.byteLength,
				valid: valid && offset === bytes.byteLength,
			};
		})());

		expect(witness.valid).toBe(true);
		expect(witness.length).toBeGreaterThan(256);
		expect(witness.boxes[0]?.type).toBe('ftyp');
		// The container's own major brand stands where the blob's content type
		// used to: reading it needed a page-side fetch of the blob: URL, which the
		// shipped policy forbids, and the exporter's audio/mp4 label is asserted at
		// its source in tests/audio-editor-media-export.test.js.
		expect(witness.brand).toBe('iso5');
		expect(witness.boxes.map(({ type }) => type)).toEqual(expect.arrayContaining(['moov', 'moof', 'mdat']));
		await exportDialog.getByRole('button', { name: 'Close', exact: true }).first().click();
		await expect(exportDialog).toBeHidden();
		const name = 'delivered-native-aac.m4a';
		await importFiles(editor, [{ name, mimeType: 'audio/mp4', buffer: Buffer.from(bytes) }]);
		await expect(clipByName(editor, name)).toBeVisible();
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		const peaks = await sourcePeakChannels(page, name);
		expect(peaks.channelCount).toBe(2);
		for (const channel of peaks.channels) {
			expect(channel.minimum).toBeLessThan(-0.25);
			expect(channel.maximum).toBeGreaterThan(0.25);
			expect(channel.maximum).toBeLessThan(0.45);
		}
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await page.reload();
		await expect(clipByName(await waitForEditor(page), name)).toBeVisible();
		expect(await sourcePeakChannels(page, name)).toEqual(peaks);
		expect(errors).toEqual([]);
	});
});
