/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseDropdown,
	collectClientErrors,
	disableNativeSavePicker,
	importFiles,
	openExportDialog,
	registerAudioEditorHooks,
} from './audio-editor-test-helpers.js';

const EXACT_AAC_CONFIGURATION = Object.freeze({
	codec: 'mp4a.40.2',
	sampleRate: 48_000,
	numberOfChannels: 2,
	bitrate: 192_000,
});

test.describe('browser-native AAC export', () => {
	registerAudioEditorHooks();

	test('generates a complete M4A file through WebCodecs', async ({ page }) => {
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
		const witness = await download.evaluate(async (link) => {
			const response = await fetch(link.href);
			const bytes = new Uint8Array(await response.arrayBuffer());
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
				contentType: response.headers.get('content-type'),
				length: bytes.byteLength,
				valid: valid && offset === bytes.byteLength,
			};
		});

		expect(witness.valid).toBe(true);
		expect(witness.length).toBeGreaterThan(256);
		expect(witness.contentType).toContain('audio/mp4');
		expect(witness.boxes[0]?.type).toBe('ftyp');
		expect(witness.boxes.map(({ type }) => type)).toEqual(expect.arrayContaining(['mdat', 'moov']));
		expect(errors).toEqual([]);
	});
});
